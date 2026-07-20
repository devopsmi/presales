import log from "@/lib/logger";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import type { RunLlmFn } from "@/lib/agent/llm";
import type { GraphState } from "@/lib/agent/state";
import type { PipelineState } from "@/lib/agent/state";

const parserLog = log.child({ agent: "parser" });

export async function parserNode(
  state: GraphState,
  config?: LangGraphRunnableConfig,
): Promise<Partial<GraphState>> {
  const runLlm = config?.configurable?.runLlm as RunLlmFn;

  parserLog.info("starting");
  const startTime = Date.now();

  config?.writer?.({ type: "agent_start", agent: "parser" });

  const systemPrompt = buildParserSystemPrompt();
  const userPrompt = buildParserUserPrompt(state);

  config?.writer?.({ type: "agent_progress", agent: "parser", message: "正在解析需求文档，提取关键信息..." });

  const pipelineState = state as unknown as PipelineState;

  let output: string;
  try {
    output = await runLlm({
      systemPrompt,
      userPrompt,
      agentName: "parser",
      state: pipelineState,
    });
  } catch (err) {
    parserLog.error("LLM call failed", { error: err as Error });
    throw err;
  }

  const customerName = extractName(output, /客户名称[：:]\s*(.+)/) ?? "未指定客户";
  const projectName = extractName(output, /^##\s*(.+)/m) ?? "未指定项目";

  const elapsed = Date.now() - startTime;
  parserLog.info("complete", { customerName, projectName, briefLength: output.length, elapsedMs: elapsed });

  config?.writer?.({
    type: "agent_complete",
    agent: "parser",
    output: { customerName, projectName },
  });

  return {
    structuredBrief: output,
    customerName,
    projectName,
  };
}

function buildParserSystemPrompt(): string {
  return `你是一位资深的售前需求分析师。请根据客户提供的原始需求文档或文字描述，整理出一份结构化的需求简报。

输出格式为 Markdown，需要包含以下内容：
1. 项目标题
2. 客户信息（客户名称、行业类型）
3. 项目概述
4. 核心模块列表
5. 技术要求
6. 交付要求

请确保输出专业、结构清晰、便于后续功能拆解。`;
}

function buildParserUserPrompt(state: GraphState): string {
  const parts: string[] = [];

  if (state.rawText) {
    parts.push(`## 客户原始需求描述\n\n${state.rawText}`);
  }

  for (const att of state.attachments) {
    parts.push(`## 附件：${att.name}（${att.type}）\n\n${att.content}`);
  }

  if (parts.length === 0) {
    parts.push("（无输入内容，请根据经验生成一个示例需求简报）");
  }

  return parts.join("\n\n---\n\n");
}

function extractName(text: string, regex: RegExp): string | null {
  const match = text.match(regex);
  return match?.[1]?.trim() ?? null;
}
