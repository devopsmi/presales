import type { UIMessage } from "ai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { Attachment, SseMessage } from "@/lib/types";
import { createModelInstance } from "@/lib/agent/llm";
import { createPresalesAgent, getFileStatusMessage } from "@/lib/agent/main-agent";
import { getSessionConfig } from "@/lib/session-config";
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
    const attachments = collectRawAttachments(uploadedFiles);
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
          const msgId = `msg-${Date.now()}`;
          send({ type: "text-start", id: msgId });

          const sid = sessionId || "default";
          const fileStatus = getFileStatusMessage(sid);
          const agentMessages = [];
          if (fileStatus) {
            agentMessages.push(new SystemMessage(fileStatus));
          }
          agentMessages.push(new HumanMessage({ content: rawText, id: msgId }));

          const run = await agent.streamEvents(
            { messages: agentMessages },
            { version: "v3", configurable: { thread_id: sid } },
          );

          await Promise.all([
            (async () => {
              for await (const message of run.messages) {
                for await (const token of message.text) {
                  send({ type: "text-delta", id: msgId, delta: token });
                }
              }
            })(),
            (async () => {
              for await (const call of run.toolCalls) {
                const toolCallId = call.callId || `tc-${call.name}-${Date.now()}`;
                send({ type: "tool-input-start", toolCallId, toolName: mapToolName(call.name) });
                send({
                  type: "tool-input-delta",
                  toolCallId,
                  inputTextDelta:
                    typeof call.input === "string" ? call.input : JSON.stringify(call.input),
                });

                const output = await call.output;
                if (output) {
                  send({
                    type: "tool-output-available",
                    toolCallId,
                    output: typeof output === "string" ? output : JSON.stringify(output),
                  });
                }
              }
            })(),
          ]);

          send({ type: "text-end", id: msgId });
          send({ type: "finish", finishReason: "stop" });
          controller.close();
        } catch (err) {
          log.error("agent failed", {
            error: err instanceof Error ? err : new Error(String(err)),
          });
          send({ type: "text-end", id: `msg-${Date.now()}` });
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
