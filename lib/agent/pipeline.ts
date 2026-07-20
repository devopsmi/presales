import type { Attachment, PipelineEvent, PipelineState } from "@/lib/agent/state";
import type { QuotationRow } from "@/lib/agent/state";
import { createInitialState } from "@/lib/agent/state";
import { runMockLlm } from "@/lib/agent/mock-llm";
import { runParserNode } from "@/lib/agent/nodes/parser";
import { runDecomposerNode } from "@/lib/agent/nodes/decomposer";
import { runEstimatorNode } from "@/lib/agent/nodes/estimator";
import { runQuoterNode } from "@/lib/agent/nodes/quoter";
import type { TradeRole } from "@/lib/constants";

/**
 * Pipeline input — mirrors what the chat route receives from the client.
 */
export interface PipelineInput {
  rawText: string;
  attachments: Attachment[];
  selectedTrades: TradeRole[];
  budgetRange: [number, number];
  modelProvider: string;
  llmProvider: "mock" | "openai";
}

type RunLlmFn = (params: {
  systemPrompt: string;
  userPrompt: string;
  agentName: string;
  state: PipelineState;
}) => Promise<string>;

async function resolveLlm(provider: "mock" | "openai"): Promise<RunLlmFn> {
  if (provider === "mock") {
    return runMockLlm;
  }
  // TODO: integrate with @langchain/openai ChatOpenAI
  throw new Error(`LLM provider not yet implemented: ${provider}`);
}

type NodeGenerator = AsyncGenerator<PipelineEvent, Partial<PipelineState>>;
type AgentCompleteEvent = Extract<PipelineEvent, { type: "agent_complete" }>;

function isQuotationRowArray(value: unknown): value is QuotationRow[] {
  if (!Array.isArray(value)) return false;
  for (const item of value) {
    if (!item || typeof item !== "object") return false;
    const obj: Record<string, unknown> = item;
    const moduleVal: unknown = obj["module"];
    const functionVal: unknown = obj["function"];
    const categoryVal: unknown = obj["category"];
    if (typeof moduleVal !== "string") return false;
    if (typeof functionVal !== "string") return false;
    if (categoryVal !== "design" && categoryVal !== "feature") return false;
  }
  return true;
}

/**
 * Drain a node's async generator, yielding each event to the outer consumer
 * and returning the node's final state delta. On `agent_complete`, also runs
 * the optional handler so the caller can update `state` from the event output.
 */
async function* drainNode(
  gen: NodeGenerator,
  onAgentComplete?: (event: AgentCompleteEvent) => void,
): AsyncGenerator<PipelineEvent, Partial<PipelineState>> {
  let next = await gen.next();
  while (!next.done) {
    if (next.value.type === "agent_complete" && onAgentComplete) {
      onAgentComplete(next.value);
    }
    yield next.value;
    next = await gen.next();
  }
  return next.value;
}

/**
 * Creates the presales pipeline as an async generator of PipelineEvents.
 *
 * Chains parser → decomposer → estimator → quoter sequentially,
 * propagating state between nodes and emitting streamable events.
 */
export async function* createPipeline(
  input: PipelineInput,
): AsyncGenerator<PipelineEvent> {
  const state: PipelineState = createInitialState(input);
  const runLlm = await resolveLlm(input.llmProvider);

  // Agent-1: Parser
  state.currentAgent = "parser";
  const parserDelta = yield* drainNode(runParserNode(state, runLlm), (event) => {
    const output = event.output;
    if (typeof output.customerName === "string") {
      state.customerName = output.customerName;
    }
    if (typeof output.projectName === "string") {
      state.projectName = output.projectName;
    }
    if (typeof output.structuredBrief === "string") {
      state.structuredBrief = output.structuredBrief;
    }
  });
  if (typeof parserDelta.structuredBrief === "string") {
    state.structuredBrief = parserDelta.structuredBrief;
  }
  if (typeof parserDelta.customerName === "string") {
    state.customerName = parserDelta.customerName;
  }
  if (typeof parserDelta.projectName === "string") {
    state.projectName = parserDelta.projectName;
  }

  // Agent-2: Decomposer
  state.currentAgent = "decomposer";
  const decomposerDelta = yield* drainNode(
    runDecomposerNode(state, runLlm),
    (event) => {
      if (isQuotationRowArray(event.output.rows)) {
        state.rows = event.output.rows;
      }
    },
  );
  if (isQuotationRowArray(decomposerDelta.rows)) {
    state.rows = decomposerDelta.rows;
  }

  // Agent-3: Estimator
  state.currentAgent = "estimator";
  const estimatorDelta = yield* drainNode(
    runEstimatorNode(state, runLlm),
    (event) => {
      if (isQuotationRowArray(event.output.rows)) {
        state.rows = event.output.rows;
      }
    },
  );
  if (isQuotationRowArray(estimatorDelta.rows)) {
    state.rows = estimatorDelta.rows;
  }

  // Agent-4: Quoter (emits its own pipeline_complete event)
  state.currentAgent = "quoter";
  yield* drainNode(runQuoterNode(state, runLlm));
}
