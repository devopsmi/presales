import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { runMockLlm } from "@/lib/agent/mock-llm";
import type { PipelineState } from "@/lib/agent/state";
import log from "@/lib/logger";

const llmLog = log.child({ module: "llm" });

export type RunLlmFn = (params: {
  systemPrompt: string;
  userPrompt: string;
  agentName: string;
  state: PipelineState;
}) => Promise<string>;

export function resolveLlm(provider: "mock" | "openai"): RunLlmFn {
  llmLog.info("LLM provider resolved", { provider });
  if (provider === "mock") return runMockLlm;
  return runOpenAiLlm;
}

async function runOpenAiLlm(params: {
  systemPrompt: string;
  userPrompt: string;
  agentName: string;
  state: PipelineState;
}): Promise<string> {
  const modelName = params.state.modelProvider || "gpt-4o";
  const model = new ChatOpenAI({
    model: modelName,
    maxTokens: 4096,
  });

  llmLog.info("OpenAI LLM call start", {
    agentName: params.agentName,
    model: modelName,
    systemPromptLength: params.systemPrompt.length,
    userPromptLength: params.userPrompt.length,
  });

  const startTime = Date.now();

  try {
    const response = await model.invoke([
      new SystemMessage(params.systemPrompt),
      new HumanMessage(params.userPrompt),
    ]);

    const elapsed = Date.now() - startTime;
    llmLog.info("OpenAI LLM call complete", {
      agentName: params.agentName,
      model: modelName,
      elapsedMs: elapsed,
    });

    return typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);
  } catch (err) {
    const elapsed = Date.now() - startTime;
    llmLog.error("OpenAI LLM call failed", {
      agentName: params.agentName,
      model: modelName,
      elapsedMs: elapsed,
      error: err instanceof Error ? err : new Error(String(err)),
    });
    throw err;
  }
}
