import log from "@/lib/logger";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import type { RunLlmFn } from "@/lib/agent/llm";
import type { GraphState } from "@/lib/agent/state";
import type { QuotationRow } from "@/lib/agent/state";
import type { PipelineState } from "@/lib/agent/state";

const decomposerLog = log.child({ agent: "decomposer" });

export async function decomposerNode(
  state: GraphState,
  config?: LangGraphRunnableConfig,
): Promise<Partial<GraphState>> {
  const runLlm = config?.configurable?.runLlm as RunLlmFn;

  decomposerLog.info("starting");
  const startTime = Date.now();

  config?.writer?.({ type: "agent_start", agent: "decomposer" });

  const systemPrompt = buildDecomposerSystemPrompt();
  const userPrompt = buildDecomposerUserPrompt(state);

  config?.writer?.({
    type: "agent_progress",
    agent: "decomposer",
    message: "正在拆解功能清单，生成报价明细项...",
  });

  const pipelineState = state as unknown as PipelineState;

  let output: string;
  try {
    output = await runLlm({
      systemPrompt,
      userPrompt,
      agentName: "decomposer",
      state: pipelineState,
    });
  } catch (err) {
    decomposerLog.error("LLM call failed", { error: err as Error });
    throw err;
  }

  const rows = parseRows(output);

  const elapsed = Date.now() - startTime;
  decomposerLog.info("complete", { rowCount: rows.length, elapsedMs: elapsed });

  config?.writer?.({
    type: "agent_complete",
    agent: "decomposer",
    output: { rowCount: rows.length },
  });

  return { rows };
}

function buildDecomposerSystemPrompt(): string {
  return `你是一位资深的软件项目功能拆解专家。请根据需求简报，将项目拆解为具体的功能清单项。

输出格式为 JSON 数组，每个元素包含：
- seq: 序号（从1开始）
- module: 模块名称（如"系统设计"、"用户端"、"管理后台"）
- sub_module: 子模块名称
- function: 功能名称
- sub_function: 子功能名称
- description: 功能描述
- category: "design"（设计类）或 "feature"（功能类）
- trades: {} (空对象，后续由估时节点填充)
- remark: "" (空字符串)

要求：
1. 设计类（design）行放在前面，包含技术架构、数据设计、UI/UX设计等
2. 功能类（feature）行涵盖所有核心业务功能
3. 总数控制在 6-12 行，粒度适中
4. 只输出纯 JSON 数组，不要包含其他文字`;
}

function buildDecomposerUserPrompt(state: GraphState): string {
  return `请根据以下需求简报拆解功能清单：

${state.structuredBrief || "（无结构化简报，请根据原始需求拆解）"}

原始需求：${state.rawText || "无"}`;
}

function parseRows(output: string): QuotationRow[] {
  const match = output.match(/\[[\s\S]*\]/);
  if (!match) {
    throw new Error("Decomposer: failed to find JSON array in LLM output");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error("Decomposer: failed to parse JSON array from LLM output");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Decomposer: expected JSON array, got " + typeof parsed);
  }

  return parsed.map((item: Record<string, unknown>, idx: number) => {
    return {
      seq: typeof item.seq === "number" ? item.seq : idx + 1,
      module: typeof item.module === "string" ? item.module : "未命名模块",
      sub_module: typeof item.sub_module === "string" ? item.sub_module : "",
      function: typeof item.function === "string" ? item.function : "",
      sub_function: typeof item.sub_function === "string" ? item.sub_function : "",
      description: typeof item.description === "string" ? item.description : "",
      category: item.category === "design" || item.category === "feature" ? item.category : "feature",
      trades: typeof item.trades === "object" && item.trades !== null
        ? (item.trades as QuotationRow["trades"])
        : {},
      remark: typeof item.remark === "string" ? item.remark : "",
    };
  });
}
