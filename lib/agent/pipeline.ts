import { StateGraph } from "@langchain/langgraph";
import { GraphStateAnnotation } from "@/lib/agent/state";
import type { GraphState } from "@/lib/agent/state";
import type { Attachment, PipelineEvent } from "@/lib/agent/state";
import type { TradeRole } from "@/lib/constants";
import { VENDOR_NAME } from "@/lib/constants";
import type { RunLlmFn } from "@/lib/agent/llm";
import log from "@/lib/logger";
import { parserNode } from "@/lib/agent/nodes/parser";
import { decomposerNode } from "@/lib/agent/nodes/decomposer";
import { estimatorNode } from "@/lib/agent/nodes/estimator";
import { quoterNode } from "@/lib/agent/nodes/quoter";

const pipelineLog = log.child({ module: "pipeline" });

export interface PipelineInput {
  rawText: string;
  attachments: Attachment[];
  selectedTrades: TradeRole[];
  budgetRange: [number, number];
  modelProvider: string;
  llmProvider: "mock" | "openai";
}

interface SseMessage {
  type: "text-start" | "text-delta" | "text-end" | "finish" | "error";
  id?: string;
  delta?: string;
  finishReason?: string;
  error?: string;
}

function buildGraph() {
  return new StateGraph(GraphStateAnnotation)
    .addNode("parser", parserNode)
    .addNode("decomposer", decomposerNode)
    .addNode("estimator", estimatorNode)
    .addNode("quoter", quoterNode)
    .addEdge("__start__", "parser")
    .addEdge("parser", "decomposer")
    .addEdge("decomposer", "estimator")
    .addEdge("estimator", "quoter")
    .addEdge("quoter", "__end__")
    .compile();
}

function initState(input: PipelineInput): GraphState {
  return {
    rawText: input.rawText,
    attachments: input.attachments,
    selectedTrades: input.selectedTrades,
    budgetRange: input.budgetRange,
    modelProvider: input.modelProvider,
    customerName: "",
    projectName: "",
    structuredBrief: "",
    rows: [],
    quotationFile: null,
    quotationJson: "",
    currentAgent: "idle",
    error: null,
  };
}

function pipelineEventToText(event: PipelineEvent): string | null {
  switch (event.type) {
    case "agent_start":
      return `\n\n### ${event.agent} 开始工作...\n\n`;
    case "agent_progress":
      return `> ${event.message}\n`;
    case "agent_complete":
      return `\n${event.agent} 完成。\n`;
    case "pipeline_complete":
      return null;
    default:
      return null;
  }
}

export async function* streamPipeline(
  input: PipelineInput,
  runLlm: RunLlmFn,
): AsyncGenerator<SseMessage> {
  const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const logger = pipelineLog.withRequestId(requestId);
  const startTime = Date.now();

  logger.info("pipeline start", {
    selectedTrades: input.selectedTrades.length,
    budgetRange: input.budgetRange,
    hasAttachments: input.attachments.length > 0,
  });

  try {
    const graph = buildGraph();
    const state = initState(input);
    const msgId = `msg-${Date.now()}`;

    const stream = await graph.stream(state, {
      streamMode: ["custom", "values"],
      configurable: { runLlm },
    });

    yield { type: "text-start", id: msgId };

    let result: GraphState | null = null;
    for await (const chunk of stream) {
      const [mode, data] = chunk as [string, unknown];
      if (mode === "custom" && isPipelineEvent(data)) {
        const text = pipelineEventToText(data);
        if (text !== null) {
          yield { type: "text-delta", id: msgId, delta: text };
        }
      }
      if (mode === "values") {
        result = data as GraphState;
      }
    }

    if (!result) {
      throw new Error("Pipeline did not produce final state");
    }
    if (result.rows.length > 0) {
      const header = {
        customerName: result.customerName || "未指定客户",
        projectName: result.projectName || "未指定项目",
        quoteDate: new Date().toISOString().slice(0, 10),
        vendorName: VENDOR_NAME,
      };
      const quotation = JSON.stringify({ header, rows: result.rows });
      yield { type: "text-delta", id: msgId, delta: `\n\n__QUOTATION__${quotation}__END_QUOTATION__\n` };
    }

    const elapsed = Date.now() - startTime;
    logger.info("pipeline complete", { rowsCount: result.rows.length, elapsedMs: elapsed });

    yield { type: "text-end", id: msgId };
    yield { type: "finish", finishReason: "stop" };
  } catch (err) {
    const elapsed = Date.now() - startTime;
    logger.error("pipeline error", { error: err as Error, elapsedMs: elapsed });
    yield { type: "text-end", id: `msg-${Date.now()}` };
    yield { type: "error", error: err instanceof Error ? err.message : "Pipeline error" };
    yield { type: "finish", finishReason: "error" };
  }
}

function isPipelineEvent(value: unknown): value is PipelineEvent {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  const validTypes = ["agent_start", "agent_progress", "agent_complete", "pipeline_complete"];
  return typeof obj.type === "string" && validTypes.includes(obj.type);
}
