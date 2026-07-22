/**
 * Estimator SubAgent — uses LangChain createAgent to fill man-day estimates
 * for each QuotationRow based on a skill-based estimation plan.
 */
import fs from "fs";
import path from "path";
import { createAgent } from "langchain";
import { HumanMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { TradeRole } from "@/lib/constants";
import { VENDOR_NAME } from "@/lib/constants";
import type { QuotationRow, QuotationHeader } from "@/lib/types";
import type { EstimatorOutput } from "@/lib/agent/state";
import { createModelLoggingMiddleware, extractStringContent } from "@/lib/agent/llm";
import log from "@/lib/logger";

const logger = log.child({ agent: "estimator" });

const PLANS_DIR = path.resolve(process.cwd(), "lib", "agent", "skills", "plans");

function loadPlan(planId: string): string {
  const planPath = path.join(PLANS_DIR, `${planId}.md`);
  const defaultPath = path.join(PLANS_DIR, "default-plan.md");
  if (fs.existsSync(planPath)) return fs.readFileSync(planPath, "utf-8");
  logger.warn("plan not found, using default", { planId });
  return fs.readFileSync(defaultPath, "utf-8");
}

function buildSystemPrompt(planContent: string): string {
  return `你是一位资深的软件项目工时估算专家。请严格按照以下估算方案，为每个功能项估算各工种所需人天。

## 估算方案
${planContent}

## 输出格式
只输出纯 JSON 数组（与输入格式相同，但 trades 字段需要填充），不要包含其他文字。`;
}

function parseEstimatedRows(output: string): QuotationRow[] {
  const match = output.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("Estimator: no JSON array found in output");

  let parsed: unknown;
  try { parsed = JSON.parse(match[0]); } catch {
    throw new Error("Estimator: failed to parse JSON");
  }
  if (!Array.isArray(parsed)) throw new Error("Estimator: expected JSON array");

  return (parsed as Array<Record<string, unknown>>).map(
    (item, idx): QuotationRow => ({
      seq: typeof item.seq === "number" ? item.seq : idx + 1,
      module: typeof item.module === "string" ? item.module : "",
      sub_module: typeof item.sub_module === "string" ? item.sub_module : "",
      function: typeof item.function === "string" ? item.function : "",
      sub_function: typeof item.sub_function === "string" ? item.sub_function : "",
      description: typeof item.description === "string" ? item.description : "",
      category: item.category === "design" || item.category === "feature" ? item.category : "feature",
      trades: typeof item.trades === "object" && item.trades !== null
        ? (item.trades as QuotationRow["trades"])
        : {},
      remark: typeof item.remark === "string" ? item.remark : "",
    }),
  );
}

function buildHeader(input: { customerName: string; projectName: string; vendorName?: string }): QuotationHeader {
  return {
    customerName: input.customerName || "未指定客户",
    projectName: input.projectName || "未指定项目",
    quoteDate: new Date().toISOString().slice(0, 10),
    vendorName: input.vendorName || VENDOR_NAME,
  };
}

function buildUserPrompt(input: {
  rows: QuotationRow[];
  selectedTrades: TradeRole[];
  customerName: string;
  projectName: string;
}): string {
  return [
    `客户选择的工种：${input.selectedTrades.join("、")}`,
    `客户名称：${input.customerName || "未指定"}`,
    `项目名称：${input.projectName || "未指定"}`,
    "",
    "以下是功能清单（trades 字段为空，请按估算方案填充）：",
    JSON.stringify(input.rows, null, 2),
    "",
    "请为每个功能项填充各工种的估算人天（只输出 JSON）。",
  ].join("\n");
}

export async function runEstimator(
  model: BaseChatModel,
  input: {
    rows: QuotationRow[];
    selectedTrades: TradeRole[];
    estimationPlanId?: string;
    customerName: string;
    projectName: string;
    vendorName?: string;
    budgetRange: [number, number];
  },
): Promise<EstimatorOutput> {
  logger.info("estimator start", { rowCount: input.rows.length, selectedTrades: input.selectedTrades });

  if (!input.rows.length) {
    const header = buildHeader(input);
    return { rows: [], header, quotationJson: JSON.stringify({ header, rows: [], summary: {} }) };
  }

  const planContent = loadPlan(input.estimationPlanId || "default-plan");
  const systemPrompt = buildSystemPrompt(planContent);
  const userPrompt = buildUserPrompt(input);

  const agent = createAgent({
    model,
    systemPrompt,
    middleware: [createModelLoggingMiddleware("estimator")],
  });

  const result = await agent.invoke({
    messages: [new HumanMessage(userPrompt)],
  });

  const output = extractStringContent(result.messages?.at(-1)?.content);

  const rows = parseEstimatedRows(output);
  const header = buildHeader(input);

  logger.info("estimator complete", { rowCount: rows.length });
  return { rows, header, quotationJson: JSON.stringify({ header, rows }) };
}
