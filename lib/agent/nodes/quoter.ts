import log from "@/lib/logger";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import type { RunLlmFn } from "@/lib/agent/llm";
import type { GraphState } from "@/lib/agent/state";
import type { QuotationHeader } from "@/lib/agent/state";
import type { PipelineState } from "@/lib/agent/state";
import { VENDOR_NAME } from "@/lib/constants";

const quoterLog = log.child({ agent: "quoter" });

export async function quoterNode(
  state: GraphState,
  config?: LangGraphRunnableConfig,
): Promise<Partial<GraphState>> {
  const runLlm = config?.configurable?.runLlm as RunLlmFn;

  quoterLog.info("starting");
  const startTime = Date.now();

  config?.writer?.({ type: "agent_start", agent: "quoter" });

  if (state.rows.length === 0) {
    config?.writer?.({
      type: "agent_complete",
      agent: "quoter",
      output: { message: "无报价数据，跳过报价生成" },
    });
    quoterLog.info("skipped (no rows)", { elapsedMs: Date.now() - startTime });
    return { quotationFile: null };
  }

  const systemPrompt = buildQuoterSystemPrompt();
  const userPrompt = buildQuoterUserPrompt(state);

  config?.writer?.({
    type: "agent_progress",
    agent: "quoter",
    message: "正在汇总报价数据，生成报价单头部...",
  });

  const pipelineState = state as unknown as PipelineState;

  let output: string;
  try {
    output = await runLlm({
      systemPrompt,
      userPrompt,
      agentName: "quoter",
      state: pipelineState,
    });
  } catch (err) {
    quoterLog.error("LLM call failed", { error: err as Error });
    throw err;
  }

  const header = parseQuotationHeader(output, pipelineState);

  const quotationJson = JSON.stringify({ header, rows: state.rows });

  const elapsed = Date.now() - startTime;
  quoterLog.info("complete", { customerName: header.customerName, projectName: header.projectName, quoteDate: header.quoteDate, elapsedMs: elapsed });

  config?.writer?.({
    type: "agent_complete",
    agent: "quoter",
    output: {
      customerName: header.customerName,
      projectName: header.projectName,
      quoteDate: header.quoteDate,
    },
  });

  config?.writer?.({
    type: "pipeline_complete",
    quotation: { header, rows: state.rows },
  });

  return {
    quotationFile: null,
    quotationJson,
    customerName: header.customerName,
    projectName: header.projectName,
  };
}

function buildQuoterSystemPrompt(): string {
  return `你是一位资深的售前报价专家。请根据功能清单的工时估算，生成报价单头部信息，并计算总价。

输出为 JSON 格式：
{
  "header": {
    "customerName": "客户名称",
    "projectName": "项目名称",
    "quoteDate": "YYYY-MM-DD",
    "vendorName": "报价单位"
  },
  "summary": "Markdown 格式的报价摘要，包含工种人天汇总表、总价、预算分析和建议"
}

只输出纯 JSON，不要包含其他文字。`;
}

function buildQuoterUserPrompt(state: GraphState): string {
  const rowsJson = JSON.stringify(state.rows, null, 2);

  return `客户名称：${state.customerName || "未指定"}
项目名称：${state.projectName || "未指定"}
预算范围：${state.budgetRange[0].toLocaleString()} - ${state.budgetRange[1].toLocaleString()} 元
报价单位：${VENDOR_NAME}

以下是已估时的功能清单：
${rowsJson}

请生成报价单头部和报价摘要。`;
}

function parseQuotationHeader(
  output: string,
  state: PipelineState,
): QuotationHeader {
  const match = output.match(/\{[\s\S]*\}/);
  if (!match) {
    return getDefaultHeader(state);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return getDefaultHeader(state);
  }

  const headerObj = (parsed.header as Record<string, unknown>) ?? parsed;

  return {
    customerName:
      typeof headerObj.customerName === "string" && headerObj.customerName.length > 0
        ? headerObj.customerName
        : (state.customerName || "未指定客户"),
    projectName:
      typeof headerObj.projectName === "string" && headerObj.projectName.length > 0
        ? headerObj.projectName
        : (state.projectName || "未指定项目"),
    quoteDate:
      typeof headerObj.quoteDate === "string" && headerObj.quoteDate.length > 0
        ? headerObj.quoteDate
        : new Date().toISOString().slice(0, 10),
    vendorName:
      typeof headerObj.vendorName === "string" && headerObj.vendorName.length > 0
        ? headerObj.vendorName
        : VENDOR_NAME,
  };
}

function getDefaultHeader(state: PipelineState): QuotationHeader {
  return {
    customerName: state.customerName || "未指定客户",
    projectName: state.projectName || "未指定项目",
    quoteDate: new Date().toISOString().slice(0, 10),
    vendorName: VENDOR_NAME,
  };
}
