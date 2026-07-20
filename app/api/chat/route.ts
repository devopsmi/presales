import type { UIMessage } from "ai";
import { streamPipeline } from "@/lib/agent/pipeline";
import type { PipelineInput } from "@/lib/agent/pipeline";
import { resolveLlm } from "@/lib/agent/llm";
import type { TradeRole } from "@/lib/constants";
import log from "@/lib/logger";

export const runtime = "nodejs";

interface PresalesConfig {
  trades?: TradeRole[];
  budgetRange?: [number, number];
  model?: string;
}

function parseConfig(rawText: string): { cleanText: string; config: PresalesConfig } {
  const markerStart = "__PRESALES_CONFIG__";
  const markerEnd = "__END_CONFIG__";
  const startIdx = rawText.indexOf(markerStart);
  if (startIdx !== 0) return { cleanText: rawText, config: {} };
  const endIdx = rawText.indexOf(markerEnd, startIdx);
  if (endIdx === -1) return { cleanText: rawText, config: {} };
  const jsonStr = rawText.slice(markerStart.length, endIdx);
  try {
    const config = JSON.parse(jsonStr) as PresalesConfig;
    return { cleanText: rawText.slice(endIdx + markerEnd.length + 1), config };
  } catch {
    return { cleanText: rawText.slice(endIdx + markerEnd.length + 1), config: {} };
  }
}

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

export async function POST(req: Request) {
  try {
    const body = await req.json();
    log.info("Chat API request received");
    const messages: UIMessage[] = body.messages ?? [];
    const lastUserMsg = [...messages].reverse().find((m: UIMessage) => m.role === "user");

    if (!lastUserMsg) {
      return new Response(JSON.stringify({ error: "No user message" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const rawText = extractTextFromParts((lastUserMsg as { parts?: unknown }).parts);
    if (!rawText) {
      return new Response(JSON.stringify({ error: "No text content" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { cleanText, config } = parseConfig(rawText);
    const selectedTrades: TradeRole[] = config.trades ?? ["frontend", "backend"];
    const budgetRange: [number, number] = config.budgetRange ?? [0, 2000000];
    const modelProvider = config.model ?? "deepseek-v3";
    const llmProvider = (process.env.LLM_PROVIDER === "openai" ? "openai" : "mock") as "mock" | "openai";

    const runLlm = resolveLlm(llmProvider);

    const pipelineInput: PipelineInput = {
      rawText: cleanText,
      attachments: [],
      selectedTrades,
      budgetRange,
      modelProvider,
      llmProvider,
    };

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const msg of streamPipeline(pipelineInput, runLlm)) {
            const chunk = JSON.stringify(msg);
            controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
          }
          controller.close();
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : "Unknown error";
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: "error", error: errMsg })}\n\n`
          ));
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: "finish", finishReason: "error" })}\n\n`
          ));
          controller.close();
        }
      },
    });

    log.info("Chat API request complete");
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    log.error("Chat API error", {error: err instanceof Error ? err : new Error(String(err))});
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
