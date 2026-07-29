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
import { getSessionConfig } from "@/lib/session-config";
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

function buildUserPromptForChunk(input: {
  module: string;
  subModule: string;
  rows: QuotationRow[];
  selectedTrades: TradeRole[];
  customerName: string;
  projectName: string;
  instructions?: string;
  totalChunks: number;
  chunkIndex: number;
}): string {
  const tradeNames = input.selectedTrades.join("、");
  const items = input.rows
    .map((r) => `${r.seq}: ${r.description}`)
    .join("\n");

  const parts = [
    `当前估算范围：${input.module} → ${input.subModule}（第 ${input.chunkIndex}/${input.totalChunks} 块）`,
    `客户选择的工种：${tradeNames}`,
    `客户名称：${input.customerName || "未指定"}`,
    `项目名称：${input.projectName || "未指定"}`,
  ];

  if (input.instructions) {
    parts.push("", `⚠️ 修改指令: ${input.instructions}`);
  }

  parts.push(
    "",
    `功能清单（共 ${input.rows.length} 项，每行为 seq: 功能描述）：`,
    items,
    "",
    `请为每项输出 {"seq号": {"工种": 人天}} 的紧凑 JSON 对象。`,
  );

  return parts.join("\n");
}

async function invokeEstimateChunk(
  model: BaseChatModel,
  systemPrompt: string,
  chunk: {
    module: string;
    subModule: string;
    rows: QuotationRow[];
    selectedTrades: TradeRole[];
    customerName: string;
    projectName: string;
    instructions?: string;
    totalChunks: number;
    chunkIndex: number;
  },
): Promise<Record<string, Record<string, unknown>>> {
  const expectedSeqs = new Set(chunk.rows.map((r) => String(r.seq)));

  for (let attempt = 0; attempt < 2; attempt++) {
    let userPrompt = buildUserPromptForChunk(chunk);
    if (attempt > 0) {
      userPrompt += `\n\n⚠️ 上一次输出校验失败，请修正后重新输出。确保覆盖 seq: ${[...expectedSeqs].join(", ")}`;
    }

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
      throw new Error(
        `Estimator [${chunk.subModule}]: empty output on attempt ${attempt + 1}`,
      );
    }

    const match = output.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error(
        `Estimator [${chunk.subModule}]: no JSON object found in output`,
      );
    }

    let parsed: unknown;
    try { parsed = JSON.parse(match[0]); } catch (err) {
      if (attempt === 0) {
        logger.warn(`estimator [${chunk.subModule}] attempt 1 parse failed, retrying`, {
          error: String(err),
        });
        continue;
      }
      throw new Error(
        `Estimator [${chunk.subModule}]: failed to parse JSON — ${String(err)}`,
      );
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      if (attempt === 0) {
        logger.warn(`estimator [${chunk.subModule}] attempt 1: not a JSON object`, {
          type: parsed === null ? "null" : typeof parsed,
        });
        continue;
      }
      throw new Error(
        `Estimator [${chunk.subModule}]: expected JSON object, got ${parsed === null ? "null" : typeof parsed}`,
      );
    }

    const obj = parsed as Record<string, unknown>;
    const gotSeqs = new Set(Object.keys(obj));
    const missing = [...expectedSeqs].filter((s) => !gotSeqs.has(s));
    if (missing.length > 0) {
      if (attempt === 0) {
        logger.warn(`estimator [${chunk.subModule}] attempt 1: missing seqs`, {
          missing: missing.join(", "),
        });
        continue;
      }
      throw new Error(
        `Estimator [${chunk.subModule}]: missing trades for seq: ${missing.join(", ")}`,
      );
    }

    // Validate each seq's trades are objects
    for (const [seqStr, trades] of Object.entries(obj)) {
      if (!trades || typeof trades !== "object" || Array.isArray(trades)) {
        throw new Error(
          `Estimator [${chunk.subModule}]: trades for seq ${seqStr} is not an object`,
        );
      }
    }

    return obj as Record<string, Record<string, unknown>>;
  }

  throw new Error(`Estimator [${chunk.subModule}]: unreachable`);
}

export async function runEstimator(
  model: BaseChatModel,
  sessionId: string,
  input: {
    rows: QuotationRow[];
    selectedTrades: TradeRole[];
    estimationPlanId: string;
    customerName: string;
    projectName: string;
    vendorName?: string;
    budgetRange: [number, number];
    instructions?: string;
  },
): Promise<EstimatorOutput> {
  logger.info("estimator start", {
    rowCount: input.rows.length,
    selectedTrades: input.selectedTrades,
    hasInstructions: !!input.instructions,
  });

  if (!input.rows.length) {
    const header = buildHeader(input);
    return { rows: [], header, quotationJson: JSON.stringify({ header, rows: [], summary: {} }) };
  }

  const overrides = getSessionConfig(sessionId)?.promptOverrides;
  const planKey = "plan_" + input.estimationPlanId.replace(/-plan$/, "").replace(/-/g, "_");
  const planContent = overrides?.[planKey]?.trim() || loadPlan(input.estimationPlanId);
  const systemPrompt = buildSystemPrompt(planContent, input.selectedTrades);

  // Group rows by sub_module for parallel chunked estimation.
  // Falls back to module-level grouping if a sub_module has too few rows.
  const groupKey = (r: QuotationRow) => `${r.module}::${r.sub_module}`;
  const chunkMap = new Map<string, QuotationRow[]>();
  for (const r of input.rows) {
    const key = groupKey(r);
    if (!chunkMap.has(key)) chunkMap.set(key, []);
    chunkMap.get(key)!.push(r);
  }

  const chunks = [...chunkMap.entries()].map(([, rows], i) => ({
    module: rows[0].module,
    subModule: rows[0].sub_module,
    rows,
    selectedTrades: input.selectedTrades,
    customerName: input.customerName,
    projectName: input.projectName,
    instructions: input.instructions,
    totalChunks: chunkMap.size,
    chunkIndex: i + 1,
  }));

  // Fire parallel estimation calls — one per sub_module
  const chunkResults = await Promise.all(
    chunks.map((chunk) => invokeEstimateChunk(model, systemPrompt, chunk)),
  );

  // Merge all chunk results into single seq→trades map
  const mergedTrades: Record<string, Record<string, unknown>> = {};
  for (const result of chunkResults) {
    Object.assign(mergedTrades, result);
  }

  const rows = parseEstimatedRows(mergedTrades, input.rows);
  const header = buildHeader(input);

  logger.info("estimator complete", {
    rowCount: rows.length,
    chunks: chunks.length,
  });
  return { rows, header, quotationJson: JSON.stringify({ header, rows }) };
}
