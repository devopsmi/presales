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
  return fs.readFileSync(planPath, "utf-8");
}

function buildSystemPrompt(planContent: string, selectedTrades: TradeRole[]): string {
  const tradeNames = selectedTrades.join("、");
  return `你是一位资深的软件项目工时估算专家。请严格按照以下估算方案，为每个功能项估算各工种所需人天。

## 估算方案
${planContent}

## 工种
本次选中的工种：${tradeNames}。
未列出的工种不要估算。

## 输出格式（紧凑映射）
纯 JSON 对象，key 为功能项 seq 号（字符串），value 为各工种人天（数字或 null）：

{"1": {"frontend": 3, "backend": 0.5}, "2": {"frontend": 1, "backend": null}}

只输出选中的工种，不参与的填 null。只输出 JSON 对象，不要其他内容。`;
}

function parseEstimatedRows(
  raw: unknown,
  originalRows: QuotationRow[],
): QuotationRow[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(
      "Estimator: expected JSON object, got " + (raw === null ? "null" : typeof raw),
    );
  }

  const obj = raw as Record<string, Record<string, unknown>>;
  const seqMap = new Map(originalRows.map((r) => [String(r.seq), r]));

  const touched = new Set<string>();

  for (const [seqStr, trades] of Object.entries(obj)) {
    const row = seqMap.get(seqStr);
    if (!row) {
      throw new Error(`Estimator: unknown seq "${seqStr}" — not in input rows`);
    }

    if (!trades || typeof trades !== "object" || Array.isArray(trades)) {
      throw new Error(`Estimator: trades for seq ${seqStr} is not an object`);
    }

    row.trades = trades as QuotationRow["trades"];
    touched.add(seqStr);
  }

  const missing = originalRows.filter((r) => !touched.has(String(r.seq)));
  if (missing.length > 0) {
    throw new Error(
      `Estimator: missing trades for seq: ${missing.map((r) => r.seq).join(", ")}`,
    );
  }

  return originalRows;
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
  const tradeNames = input.selectedTrades.join("、");
  const items = input.rows
    .map((r) => `${r.seq}: ${r.description}`)
    .join("\n");

  return [
    `客户选择的工种：${tradeNames}`,
    `客户名称：${input.customerName || "未指定"}`,
    `项目名称：${input.projectName || "未指定"}`,
    "",
    `功能清单（共 ${input.rows.length} 项，每行为 seq: 功能描述）：`,
    items,
    "",
    `请为每项输出 {"seq号": {"工种": 人天}} 的紧凑 JSON 对象。`,
  ].join("\n");
}

export async function runEstimator(
  model: BaseChatModel,
  input: {
    rows: QuotationRow[];
    selectedTrades: TradeRole[];
    estimationPlanId: string;
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

  const planContent = loadPlan(input.estimationPlanId);
  const systemPrompt = buildSystemPrompt(planContent, input.selectedTrades);
  const userPrompt = buildUserPrompt(input);

  const agent = createAgent({
    model,
    systemPrompt,
    middleware: [createModelLoggingMiddleware("estimator")],
  });

  const result = await agent.invoke({
    messages: [new HumanMessage(userPrompt)],
  });

  const rawContent = result.messages?.at(-1)?.content;
  const output = extractStringContent(rawContent);

  if (!output) {
    const blocks = Array.isArray(rawContent)
      ? (rawContent as Array<{ type: string }>).map((b) => b.type).join(", ")
      : typeof rawContent;
    logger.error("estimator empty output", {
      blockTypes: blocks,
      rawLen: JSON.stringify(rawContent).length,
    });
  }

  // Parse compact object → stitch trades into original rows
  const match = output.match(/\{[\s\S]*\}/);
  if (!match) {
    const preview = (output || "").slice(0, 500);
    throw new Error(
      `Estimator: no JSON object found in output (len=${(output || "").length}, preview: ${preview})`,
    );
  }

  let parsed: unknown;
  try { parsed = JSON.parse(match[0]); } catch {
    throw new Error("Estimator: failed to parse JSON object");
  }

  const rows = parseEstimatedRows(parsed, input.rows);
  const header = buildHeader(input);

  logger.info("estimator complete", { rowCount: rows.length });
  return { rows, header, quotationJson: JSON.stringify({ header, rows }) };
}
