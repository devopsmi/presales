import type { UIMessage } from "ai";
import { HumanMessage } from "@langchain/core/messages";
import type { Attachment, SseMessage } from "@/lib/types";
import { createModelInstance } from "@/lib/agent/llm";
import { createPresalesAgent, getFileStatusMessage } from "@/lib/agent/main-agent";
import { getSessionConfig } from "@/lib/session-config";
import { MAX_FILE_COUNT, MAX_SINGLE_FILE_SIZE_MB, ALLOWED_FILE_TYPES } from "@/lib/constants";
import log from "@/lib/logger";

export const runtime = "nodejs";

function extractTextFromParts(parts: unknown): string {
  if (typeof parts === "string") return parts;
  if (Array.isArray(parts)) {
    return parts
      .filter((p: { type?: string; text?: string }) => p.type === "text")
      .map((p: { type?: string; text?: string }) => p.text ?? "")
      .join("\n");
  }
  return "";
}

interface SerializedFile {
  name: string;
  type: "pdf" | "word" | "excel" | "image";
  data: string;
}

interface UploadError {
  index: number;
  name: string;
  reason: string;
}

function validateFiles(files: SerializedFile[]): {
  valid: SerializedFile[];
  errors: UploadError[];
} {
  if (files.length > MAX_FILE_COUNT) {
    return {
      valid: [],
      errors: [{ index: -1, name: "", reason: `文件数量超过限制 (最多 ${MAX_FILE_COUNT} 个)` }],
    };
  }

  const valid: SerializedFile[] = [];
  const errors: UploadError[] = [];

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!(ALLOWED_FILE_TYPES as readonly string[]).includes(f.type)) {
      errors.push({
        index: i,
        name: f.name,
        reason: `不支持的文件类型 "${f.type}"，允许的类型: ${ALLOWED_FILE_TYPES.join(", ")}`,
      });
      continue;
    }
    if (!f.data || typeof f.data !== "string" || f.data.length === 0) {
      errors.push({ index: i, name: f.name, reason: "文件数据为空" });
      continue;
    }
    const decodedSize = Buffer.byteLength(f.data, "base64");
    if (decodedSize > MAX_SINGLE_FILE_SIZE_MB * 1024 * 1024) {
      errors.push({
        index: i,
        name: f.name,
        reason: `文件过大 (${(decodedSize / 1024 / 1024).toFixed(1)}MB)，单文件限制 ${MAX_SINGLE_FILE_SIZE_MB}MB`,
      });
      continue;
    }
    valid.push(f);
  }

  return { valid, errors };
}

function collectRawAttachments(files: SerializedFile[]): Attachment[] {
  return files.map((f) => ({
    name: f.name,
    type: f.type,
    content: "",
    rawData: f.data,
  }));
}

function mapToolName(raw: string): string {
  const m: Record<string, string> = {
    parse_files: "subagent_file_parser",
    grill_me: "grill_me",
    decompose: "subagent_decomposer",
    estimate_hours: "subagent_estimator",
    evaluate: "subagent_evaluator",
  };
  return m[raw] || raw;
}

// ---------------------------------------------------------------------------
// POST /api/chat
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const sessionId: string | undefined = body.sessionId;
    const messages: UIMessage[] = body.messages ?? [];
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return jsonErr("No user message", 400);

    const rawText = extractTextFromParts(
      (lastUserMsg as { parts?: unknown }).parts,
    );
    if (!rawText) return jsonErr("No text content", 400);

    const uploadedFiles: SerializedFile[] = Array.isArray(body.files) ? body.files : [];
    const { valid, errors } = validateFiles(uploadedFiles);

    if (errors.length > 0) {
      if (valid.length === 0) {
        return jsonErr(`文件验证失败: ${errors.map(e => e.reason).join("; ")}`, 400);
      }
      log.warn("some files rejected during upload", {
        sessionId,
        rejectedCount: errors.length,
        acceptedCount: valid.length,
        errors: errors.map(e => ({ name: e.name, reason: e.reason })),
      });
    }

    const attachments = collectRawAttachments(valid);
    const config = getSessionConfig(sessionId ?? "");

    const modelCfg = config.models.find((m) => m.id === config.model);
    const model = createModelInstance(modelCfg, "openai");

    const agent = createPresalesAgent({
      model,
      attachments,
      sessionId: sessionId || "default",
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (msg: SseMessage) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`));

        try {
          const sid = sessionId || "default";
          const fileStatus = getFileStatusMessage(sid);
          const userContent = fileStatus
            ? `${fileStatus}\n\n用户消息: ${rawText}`
            : rawText;
          const agentMessages = [new HumanMessage({ content: userContent, id: `msg-${Date.now()}` })];

          const run = await agent.streamEvents(
            { messages: agentMessages },
            { version: "v3", configurable: { thread_id: sid } },
          );

          // Synchronization flag: set to true when a tool event is sent, so the
          // text loop can split its text part before streaming more text. This
          // ensures tool cards appear interleaved with text at their invocation
          // position rather than all at the end.
          let toolEventInterrupted = false;
          let textCounter = 0;

          // Batch text-delta events at ~60fps to reduce the number of SSE
          // messages and React state updates during streaming. Without batching,
          // each individual token triggers a separate SSE event, causing 50+
          // re-renders per second on the client.
          const TEXT_FLUSH_INTERVAL_MS = 16;

          await Promise.all([
            (async () => {
              for await (const message of run.messages) {
                let textStarted = false;
                let currentTextId = `${Date.now()}-${textCounter++}`;
                let tokenBuffer: string[] = [];
                let lastFlushTime = 0;

                const flushBuffer = () => {
                  if (tokenBuffer.length === 0) return;
                  const combined = tokenBuffer.join("");
                  tokenBuffer = [];
                  lastFlushTime = Date.now();
                  if (!textStarted) {
                    send({ type: "text-start", id: currentTextId });
                    textStarted = true;
                  }
                  send({ type: "text-delta", id: currentTextId, delta: combined });
                };

                for await (const token of message.text) {
                  // If a tool event was sent since the last text token,
                  // close the current text part and start a new one so
                  // the tool card sits between them.
                  if (toolEventInterrupted) {
                    flushBuffer();
                    if (textStarted) {
                      send({ type: "text-end", id: currentTextId });
                    }
                    currentTextId = `${Date.now()}-${textCounter++}`;
                    textStarted = false;
                    toolEventInterrupted = false;
                  }

                  tokenBuffer.push(token);

                  const now = Date.now();
                  if (now - lastFlushTime >= TEXT_FLUSH_INTERVAL_MS) {
                    flushBuffer();
                  }
                }
                // Flush remaining tokens and end the text part
                flushBuffer();
                if (textStarted) {
                  send({ type: "text-end", id: currentTextId });
                }
              }
            })(),
            (async () => {
              for await (const call of run.toolCalls) {
                toolEventInterrupted = true;
                const toolCallId = call.callId || `tc-${call.name}-${Date.now()}`;
                send({ type: "tool-input-start", toolCallId, toolName: mapToolName(call.name) });
                send({
                  type: "tool-input-delta",
                  toolCallId,
                  inputTextDelta:
                    typeof call.input === "string" ? call.input : JSON.stringify(call.input),
                });

                // Wrap in try/catch so tool errors don't break the SSE stream.
                // The agent may retry the tool after receiving the error feedback,
                // and the stream must stay open for the frontend to see the retry results.
                try {
                  const output = await call.output;
                  if (output) {
                    send({
                      type: "tool-output-available",
                      toolCallId,
                      output: typeof output === "string" ? output : JSON.stringify(output),
                    });
                  }
                } catch (toolErr) {
                  const errMsg = toolErr instanceof Error ? toolErr.message : String(toolErr);
                  log.warn("tool call failed (stream stays open for retry)", {
                    toolName: call.name,
                    error: errMsg,
                  });
                  send({
                    type: "tool-output-available",
                    toolCallId,
                    output: JSON.stringify({ status: "error", message: errMsg }),
                  });
                }
              }
            })(),
          ]);

          send({ type: "finish", finishReason: "stop" });
          controller.close();
        } catch (err) {
          log.error("agent failed", {
            error: err instanceof Error ? err : new Error(String(err)),
          });
          send({
            type: "error",
            error: err instanceof Error ? err.message : "Agent error",
          });
          send({ type: "finish", finishReason: "error" });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    return jsonErr(err instanceof Error ? err.message : "Internal error", 500);
  }
}

function jsonErr(error: string, status: number) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
