import type { PipelineState, PipelineEvent, QuotationRow } from "@/lib/agent/state";
import type { TradeRole } from "@/lib/constants";

/**
 * Estimator node: fills man-day estimates (trades) for each quotation row.
 *
 * Input: state.rows (from decomposer) + state.selectedTrades
 * Output: updated rows with trades field populated.
 *
 * Yields agent_start / agent_progress / agent_complete events,
 * and returns { rows: QuotationRow[] }.
 */
export async function* runEstimatorNode(
  state: PipelineState,
  runLlm: (params: {
    systemPrompt: string;
    userPrompt: string;
    agentName: string;
    state: PipelineState;
  }) => Promise<string>,
): AsyncGenerator<PipelineEvent, Partial<PipelineState>> {
  yield { type: "agent_start", agent: "estimator" };

  if (state.rows.length === 0) {
    yield {
      type: "agent_complete",
      agent: "estimator",
      output: { rowCount: 0, message: "无功能清单行，跳过估时" },
    };
    return { rows: [] };
  }

  const systemPrompt = buildEstimatorSystemPrompt();
  const userPrompt = buildEstimatorUserPrompt(state);

  yield {
    type: "agent_progress",
    agent: "estimator",
    message: `正在为 ${state.rows.length} 个功能项估算人天，工种：${state.selectedTrades.join(", ")}...`,
  };

  const output = await runLlm({
    systemPrompt,
    userPrompt,
    agentName: "estimator",
    state,
  });

  const rows = parseEstimatedRows(output);

  yield {
    type: "agent_complete",
    agent: "estimator",
    output: {
      rowCount: rows.length,
      estimatedTrades: countEstimatedTrades(rows),
    },
  };

  return { rows };
}

function buildEstimatorSystemPrompt(): string {
  return `你是一位资深的软件项目工时估算专家。请根据功能清单和客户选择的工种，为每个功能项估算各工种所需人天。

输出格式为 JSON 数组（与输入格式相同），但每个元素的 trades 字段需要填充：

- 对于 design 类行：只有架构/设计相关工种需填人天（后端、设计），其他工种填 null
- 对于 feature 类行：前端、后端、设计工种填人天，测试、PM等可选填
- 人天范围：设计类 2-5 人天，功能类 0.5-3 人天
- 不需要该工种的行填 null

只输出纯 JSON 数组，不要包含其他文字。`;
}

function buildEstimatorUserPrompt(state: PipelineState): string {
  const rowsJson = JSON.stringify(state.rows, null, 2);

  return `客户选择的工种：${state.selectedTrades.join(", ")}

以下是功能清单（trades 字段为空，请填充）：
${rowsJson}

请为每个功能项填充各工种的估算人天。`;
}

function parseEstimatedRows(output: string): QuotationRow[] {
  const match = output.match(/\[[\s\S]*\]/);
  if (!match) {
    throw new Error("Estimator: failed to find JSON array in LLM output");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error("Estimator: failed to parse JSON array from LLM output");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Estimator: expected JSON array, got " + typeof parsed);
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

function countEstimatedTrades(rows: QuotationRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    for (const [trade, val] of Object.entries(row.trades)) {
      if (typeof val === "number" && val > 0) {
        counts[trade] = (counts[trade] ?? 0) + 1;
      }
    }
  }
  return counts;
}
