/**
 * Main Agent — presales orchestration via LangChain createAgent (Subagent pattern).
 *
 * Exposes 6 tools (3 sub-agents + query_file + grill-me + read_rows) to the LLM.
 *
 * Agent + MemorySaver are module-level singletons – created once, reused across
 * all requests per model. Each tool resolves its session-scoped PipelineCache
 * and SessionConfig at runtime via config.configurable.thread_id (= sessionId).
 *
 * Dispatch chain:
 *   parse_files → query_file → grill_me → decompose → evaluate → estimate_hours
 *   read_rows can be used after decompose to inspect rows before modifications.
 *
 * Tools:
 *   parse_files    → FileParser sub-agent + auto-generates structuredBrief
 *   query_file     → read parsed file content by index
 *   decompose      → Decomposer sub-agent — also handles row modifications via roundInstructions
 *   evaluate       → Evaluator sub-agent — checks decomposition fidelity against brief
 *   estimate_hours → Estimator sub-agent + quotation computation
 *   grill_me       → loads grill-me skill, runs clarification check (before or after brief)
 */
import fs from "fs";
import path from "path";
import { createAgent, tool } from "langchain";
import { MemorySaver } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Attachment } from "@/lib/types";
import type { TradeRole } from "@/lib/constants";
import { TRADE_DAILY_RATES } from "@/lib/constants";
import type { QuotationRow, QuotationHeader } from "@/lib/types";
import type { PipelineStage, DecomposerProgress, StoredFile, EvaluatorOutput } from "@/lib/agent/state";
import { getSessionConfig } from "@/lib/session-config";
import { parseFile } from "@/lib/agent/tools/file-parser";
import { runDecomposer } from "@/lib/agent/sub-agents/decomposer/index";
import { runEstimator } from "@/lib/agent/sub-agents/estimator";
import { runEvaluator } from "@/lib/agent/sub-agents/evaluator";
import log from "@/lib/logger";
import { createModelLoggingMiddleware } from "@/lib/agent/llm";
import { resolvePrompt } from "@/lib/prompt-defaults";

const logger = log.child({ agent: "main" });

// ---------------------------------------------------------------------------
// Module-level singletons — survive across HTTP requests
// ---------------------------------------------------------------------------

/** Shared MemorySaver — one instance per process, keyed by thread_id (= sessionId) */
const sharedCheckpointer = new MemorySaver();

/** Compiled agent cache — keyed by model name, avoids re-creating the LangGraph graph */
const agentCache = new Map<string, ReturnType<typeof createAgent>>();

function getModelKey(model: BaseChatModel): string {
  // BaseChatModel stores model name in private fields; access via unknown cast
  const m = model as unknown as Record<string, unknown>;
  return (m.model as string) || (m.modelName as string) || "default";
}

function getSessionId(config?: RunnableConfig): string {
  return (config?.configurable?.thread_id as string) || "default";
}

// ---------------------------------------------------------------------------
// Session-level pipeline cache — survives across POST /api/chat requests.
// In-memory only (same lifetime as MemorySaver). Evicts oldest on overflow.
// ---------------------------------------------------------------------------

const SESSION_CACHE_MAX = 100;
const sessionCaches = new Map<string, PipelineCache>();

function getOrCreateSessionCache(sessionId: string): PipelineCache {
  let cache = sessionCaches.get(sessionId);
  if (!cache) {
    if (sessionCaches.size >= SESSION_CACHE_MAX) {
      const oldest = sessionCaches.keys().next().value!;
      sessionCaches.delete(oldest);
    }
    cache = createCache();
    sessionCaches.set(sessionId, cache);
    logger.info("session cache created", { sessionId });
  }
  return cache;
}

function ingestAttachments(cache: PipelineCache, attachments: Attachment[]): void {
  let nextIndex = cache.fileStore.size;
  for (const att of attachments) {
    if (!att.rawData) continue;
    const existing = Array.from(cache.fileStore.values()).find(
      (f) => f.name === att.name && f.body === att.rawData,
    );
    if (existing) continue;
    cache.fileStore.set(nextIndex, {
      index: nextIndex,
      name: att.name,
      type: att.type,
      body: att.rawData,
      parsed: "",
    });
    logger.info("file ingested", { index: nextIndex, name: att.name, type: att.type });
    nextIndex++;
  }
}

/**
 * Get a human-readable file status summary for the given session.
 * Returns null if no files have been uploaded.
 *
 * Used by the API route to inject file context into the agent's messages,
 * since tool descriptions are now static (agent is a cached singleton).
 */
export function getFileStatusMessage(sessionId: string): string | null {
  const cache = sessionCaches.get(sessionId);
  if (!cache) return null;
  const all = Array.from(cache.fileStore.values());
  if (!all.length) return null;

  const unparsed = all.filter((f) => !f.parsed);
  const parsed = all.filter((f) => f.parsed);

  const parts: string[] = [];
  if (unparsed.length) parts.push(`待解析：${unparsed.map((f) => `[${f.index}] ${f.name}`).join(" ")}`);
  if (parsed.length) parts.push(`已解析：${parsed.map((f) => `[${f.index}] ${f.name}`).join(" ")}`);

  return `当前文件（共 ${all.length} 个）：${parts.join("  ")}。${unparsed.length ? "请先调用 parse_files 解析待解析文件。" : ""}`;
}

export function clearSessionCache(sessionId: string): boolean {
  return sessionCaches.delete(sessionId);
}

export function getDecomposerProgress(sessionId: string): DecomposerProgress | null {
  const cache = sessionCaches.get(sessionId);
  return cache?.decomposerProgress ?? null;
}

// ---------------------------------------------------------------------------
// Skill prompts
// ---------------------------------------------------------------------------

const SKILLS_DIR = path.resolve(process.cwd(), "lib", "agent", "skills");

function loadSkillContent(skillName: string): string {
  const skillPath = path.join(SKILLS_DIR, `${skillName}.md`);
  if (fs.existsSync(skillPath)) return fs.readFileSync(skillPath, "utf-8");
  return `Skill "${skillName}" 未找到。`;
}

// ---------------------------------------------------------------------------
// Pipeline cache — shared across tool calls via session-scoped Map
// ---------------------------------------------------------------------------

interface PipelineCache {
  stage: PipelineStage;
  structuredBrief: string;
  customerName: string;
  projectName: string;
  rows: QuotationRow[];
  header: QuotationHeader | null;
  fileStore: Map<number, StoredFile>;
  decomposerProgress: DecomposerProgress | null;
  evaluationResult: EvaluatorOutput | null;
  evaluateCount: number;
}

function createCache(): PipelineCache {
  return {
    stage: "idle",
    structuredBrief: "",
    customerName: "",
    projectName: "",
    rows: [],
    header: null,
    fileStore: new Map(),
    decomposerProgress: null,
    evaluationResult: null,
    evaluateCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Quotation computation (pure function)
// ---------------------------------------------------------------------------

function computeQuotationResult(
  rows: QuotationRow[],
  header: QuotationHeader,
  selectedTrades: TradeRole[],
  budgetRange: [number, number],
  quotedRates: Partial<Record<TradeRole, number>> = TRADE_DAILY_RATES,
) {
  const tradeTotals: Record<string, number> = {};
  for (const row of rows) {
    for (const [trade, val] of Object.entries(row.trades)) {
      if (typeof val === "number" && val > 0) {
        tradeTotals[trade] = (tradeTotals[trade] ?? 0) + val;
      }
    }
  }

  let totalCost = 0;
  for (const [trade, manDays] of Object.entries(tradeTotals)) {
    const rate = quotedRates[trade as TradeRole] ?? TRADE_DAILY_RATES[trade as TradeRole] ?? 2000;
    totalCost += manDays * rate;
  }

  const [bMin, bMax] = budgetRange;
  let budgetAdvice = "未设置预算";

  // Auto-scale all man-day values when total cost is outside budget range.
  // Must recalculate totals from scaled rows rather than just multiplying
  // tradeTotals — rounding to 1dp means sum(row) ≠ sum(previous) × factor.
  if ((bMin > 0 || bMax > 0) && totalCost > 0) {
    let scaleFactor: number | null = null;
    if (totalCost < bMin && bMin > 0) {
      scaleFactor = bMin / totalCost;
    } else if (totalCost > bMax) {
      scaleFactor = bMax / totalCost;
    }

    if (scaleFactor != null) {
      for (const row of rows) {
        for (const key of Object.keys(row.trades) as TradeRole[]) {
          const val = row.trades[key];
          if (typeof val === "number" && val > 0) {
            row.trades[key] = Math.round(val * scaleFactor * 10) / 10;
          }
        }
      }
      for (const key of Object.keys(tradeTotals)) {
        tradeTotals[key] = 0;
      }
      for (const row of rows) {
        for (const [trade, val] of Object.entries(row.trades)) {
          if (typeof val === "number" && val > 0) {
            tradeTotals[trade] = (tradeTotals[trade] ?? 0) + val;
          }
        }
      }
      totalCost = 0;
      for (const [trade, manDays] of Object.entries(tradeTotals)) {
        const rate = quotedRates[trade as TradeRole] ?? TRADE_DAILY_RATES[trade as TradeRole] ?? 2000;
        totalCost += manDays * rate;
      }

      const pct = Math.round(Math.abs(scaleFactor - 1) * 100);
      const direction = scaleFactor > 1 ? "上调" : "下调";
      budgetAdvice = `总报价 ${totalCost.toLocaleString()} 元（自动${direction}${pct}%，系数 ${scaleFactor.toFixed(2)}），已调整至预算范围内`;
    } else {
      budgetAdvice = `总报价 ${totalCost.toLocaleString()} 元在预算范围内`;
    }
  } else if (bMin > 0 || bMax > 0) {
    budgetAdvice = `总报价 ${totalCost.toLocaleString()} 元在预算范围内`;
  }

  const trades = new Set<TradeRole>();
  for (const row of rows)
    for (const key of Object.keys(row.trades) as TradeRole[])
      if (row.trades[key] != null) trades.add(key);

  return { header, rows, trades: Array.from(trades), tradeTotals, totalCost, budgetAdvice };
}

// ---------------------------------------------------------------------------
// Tool builders — all resolve session via config.configurable.thread_id
// ---------------------------------------------------------------------------

function buildParseFilesTool() {
  return tool(
    async ({ rawText: _rawText }: { rawText: string }, config?: RunnableConfig) => {
      const sessionId = getSessionId(config);
      const cache = getOrCreateSessionCache(sessionId);
      logger.info("parse_files called", { sessionId });

      const files = Array.from(cache.fileStore.values());
      const unparsed = files.filter((f) => !f.parsed);
      let parsedCount = 0;

      for (const file of unparsed) {
        try {
          const buffer = Buffer.from(file.body, "base64");
          const content = await parseFile(buffer, file.type, file.name);
          file.parsed = content;
          parsedCount++;
          logger.info("file parsed", { index: file.index, name: file.name, type: file.type });
        } catch (err) {
          logger.error("file parse failed", { index: file.index, name: file.name, type: file.type, error: err });
        }
      }

      // Auto-generate structuredBrief from parsed file content
      const all = Array.from(cache.fileStore.values());
      const parsed = all.filter((f) => f.parsed);
      const stillUnparsed = all.filter((f) => !f.parsed);

      if (parsed.length > 0) {
        const briefParts: string[] = ["## 文件解析汇总\n"];
        for (const f of parsed) {
          briefParts.push(`### ${f.name}\n${f.parsed}`);
        }
        cache.structuredBrief = briefParts.join("\n");

        // Extract customerName and projectName from file content
        const allContent = parsed.map((f) => f.parsed).join("\n");
        cache.customerName =
          allContent.match(/客户名称[：:]\s*(.+)/)?.[1]?.trim() ??
          allContent.match(/客户[：:]\s*(.+)/)?.[1]?.trim() ??
          "未指定客户";
        cache.projectName =
          allContent.match(/项目名[称称][：:]\s*(.+)/)?.[1]?.trim() ??
          allContent.match(/项目[：:]\s*(.+)/)?.[1]?.trim() ??
          "未指定项目";

        logger.info("brief auto-generated from parsed files", {
          sessionId,
          customerName: cache.customerName,
          projectName: cache.projectName,
          fileCount: parsed.length,
        });
      }

      cache.stage = "parsed";

      return JSON.stringify({
        status: "ok",
        parsedCount: parsed.length,
        unparsedCount: stillUnparsed.length,
        parsedFiles: parsed.map((f) => ({ name: f.name, type: f.type, parsed: f.parsed })),
        message: parsed.length > 0
          ? `文件解析完成：${parsed.length} 个已解析，需求简报已自动生成。${stillUnparsed.length ? ` ${stillUnparsed.length} 个解析失败。` : ""}`
          : "没有文件需要解析。",
      });
    },
    {
      name: "parse_files",
      description: "解析待解析文件的文本内容（PDF/Word/Excel/图片），自动生成需求简报。",
      schema: z.object({
        rawText: z.string().describe("用户的完整原始需求描述文本"),
      }),
    },
  );
}

function buildQueryFileTool() {
  return tool(
    async ({ index }: { index: number }, config?: RunnableConfig) => {
      const sessionId = getSessionId(config);
      const cache = getOrCreateSessionCache(sessionId);
      const file = cache.fileStore.get(index);
      if (!file) return JSON.stringify({ error: `文件索引 ${index} 不存在` });
      if (!file.parsed)
        return JSON.stringify({
          name: file.name,
          type: file.type,
          index,
          parsed: false,
          hint: "尚未解析，请先调用 parse_files",
        });
      return JSON.stringify({ name: file.name, type: file.type, index, parsed: true, content: file.parsed });
    },
    {
      name: "query_file",
      description: "查询指定文件索引的已解析内容。参数为文件索引号。使用前请确保已调用 parse_files。",
      schema: z.object({ index: z.number().describe("文件索引号") }),
    },
  );
}

function buildDecomposeTool(model: BaseChatModel) {
  return tool(
    async ({ roundInstructions }: { roundInstructions?: { r1?: string; r2?: string; r3?: string; r4?: string } }, config?: RunnableConfig) => {
      const sessionId = getSessionId(config);
      const cache = getOrCreateSessionCache(sessionId);

      // Inline stage validation
      if (!cache.structuredBrief) {
        return JSON.stringify({ status: "error", message: "请先完成需求简报（文件解析后自动生成，或调用 parse_files）" });
      }

      logger.info("decompose called", { sessionId, hasRoundInstructions: !!roundInstructions });

      // Clear stale progress before starting
      cache.decomposerProgress = null;

      const result = await runDecomposer(
        model,
        sessionId,
        {
          structuredBrief: cache.structuredBrief,
          roundInstructions,
          previousRows: cache.rows.length > 0 ? cache.rows : undefined,
        },
        (progress) => {
          cache.decomposerProgress = progress;
        },
      );

      cache.stage = "decomposed";
      cache.rows = result.rows;

      return JSON.stringify({
        status: "ok",
        rowCount: result.rows.length,
        message: `功能拆解完成，共 ${result.rows.length} 个功能项。`,
      });
    },
    {
      name: "decompose",
      description: "将需求简报拆解为五级功能清单。文件解析完成后简报自动生成，无需手动保存。可通过 roundInstructions 精准指定需要修改的拆解层级（如只需调整子模块→调 r2，只需增删功能→调 r3）。不传 roundInstructions 则为全新拆解；传入 roundInstructions 则为定向修改（基于现有清单，只修改指定层级）。",
      schema: z.object({
        roundInstructions: z.object({
          r1: z.string().optional().describe("模块层（R1）修改指令。适用于增删/合并/拆分模块。如'把模块A和模块B合并为模块AB'。"),
          r2: z.string().optional().describe("子模块层（R2）修改指令。适用于增删/调整子模块归属。如'在模块A下新增子模块权限控制'。"),
          r3: z.string().optional().describe("功能层（R3）修改指令。适用于增删/调整功能。如'在子模块订单管理下新增功能批量发货'。"),
          r4: z.string().optional().describe("子功能层（R4）修改指令。适用于增删子功能、修改描述。如'为功能订单列表新增子功能导出Excel'。"),
        }).optional().describe("按层级精准传递修改指令。哪个层级需要改就传哪个key，未改的层级省略。"),
      }),
    },
  );
}

function buildEstimateHoursTool(model: BaseChatModel) {
  return tool(
    async ({ instructions }: { instructions?: string }, config?: RunnableConfig) => {
      const sessionId = getSessionId(config);
      const cache = getOrCreateSessionCache(sessionId);
      const sessionConfig = getSessionConfig(sessionId);

      // Inline stage validation: require evaluate to have passed first
      if (!cache.structuredBrief) {
        return JSON.stringify({ status: "error", message: "请先完成需求简报" });
      }
      if (!cache.rows.length) {
        return JSON.stringify({ status: "error", message: "功能清单为空，请先完成功能拆解（调用 decompose）" });
      }
      if (cache.stage !== "evaluated") {
        return JSON.stringify({ status: "error", message: "请先完成功能拆解评估（调用 evaluate）" });
      }

      const isModification = !!instructions;
      logger.info("estimate_hours called", {
        sessionId,
        rowCount: cache.rows.length,
        isModification,
      });

      const result = await runEstimator(model, sessionId, {
        rows: cache.rows,
        selectedTrades: sessionConfig.trades,
        estimationPlanId: sessionConfig.estimationPlanId,
        customerName: cache.customerName,
        projectName: cache.projectName,
        vendorName: sessionConfig.vendorName,
        budgetRange: sessionConfig.budgetRange,
        instructions,
      });

      cache.stage = "estimated";
      cache.rows = result.rows;
      cache.header = result.header;
      cache.evaluateCount = 0;

      const quotation = computeQuotationResult(
        result.rows,
        result.header,
        sessionConfig.trades,
        sessionConfig.budgetRange,
        sessionConfig.quotedRates,
      );
      return JSON.stringify(quotation);
    },
    {
      name: "estimate_hours",
      description: "为功能清单估算各工种人天并自动计算报价。必须在 evaluate 通过后调用。可传入 instructions 做定向修改（如工时调整），不传则为全新估算。",
      schema: z.object({
        instructions: z.string().optional().describe("修改指令。如'前端工时整体增加50%'、'只重估seq 5-10的行'、'backend减半'。不传则全量估算。"),
      }),
    },
  );
}

function buildEvaluateTool(model: BaseChatModel) {
  const MAX_EVALUATE_CALLS = 2;

  return tool(
    async (_input: Record<string, never>, config?: RunnableConfig) => {
      const sessionId = getSessionId(config);
      const cache = getOrCreateSessionCache(sessionId);

      if (!cache.structuredBrief) {
        return JSON.stringify({ status: "error", message: "请先完成需求简报（parse_files 后自动生成）" });
      }
      if (!cache.rows.length) {
        return JSON.stringify({ status: "error", message: "功能清单为空，请先完成功能拆解（调用 decompose）" });
      }

      cache.evaluateCount++;
      if (cache.evaluateCount > MAX_EVALUATE_CALLS) {
        logger.warn("evaluate limit exceeded", { sessionId, count: cache.evaluateCount });
        const remaining = cache.rows.filter(r => Object.keys(r.trades).length > 0).length;
        // Unlock pipeline so estimate_hours can pass its stage check
        cache.stage = "evaluated";
        return JSON.stringify({
          status: "evaluate_limit",
          evaluateCount: cache.evaluateCount,
          maxEvaluates: MAX_EVALUATE_CALLS,
          passed: false,
          message: `evaluate 已调用 ${cache.evaluateCount} 次（上限 ${MAX_EVALUATE_CALLS} 次），不再进行评估。请直接调用 estimate_hours 生成最终报价表。${remaining > 0 ? `当前已有 ${remaining} 行存在工时数据，可基于现有结果估算。` : ""}`,
        });
      }

      logger.info("evaluate called", { sessionId, rowCount: cache.rows.length, evaluateCount: cache.evaluateCount });

      const result = await runEvaluator(model, sessionId, {
        rows: cache.rows,
        structuredBrief: cache.structuredBrief,
      });

      cache.evaluationResult = result;

      if (result.passed) {
        cache.stage = "evaluated";
      }

      return JSON.stringify({
        passed: result.passed,
        evaluateCount: cache.evaluateCount,
        maxEvaluates: MAX_EVALUATE_CALLS,
        summary: result.summary,
        issues: result.issues,
        message: result.passed
          ? `评估通过：功能拆解与原需求一致。`
          : `评估不通过（第 ${cache.evaluateCount}/${MAX_EVALUATE_CALLS} 次）：发现 ${result.issues.filter(i => i.severity === "error").length} 个错误、${result.issues.filter(i => i.severity === "warning").length} 个警告。请根据 issues 中的具体描述修正后重新评估。`,
      });
    },
    {
      name: "evaluate",
      description: "评估功能拆解与原需求简报的一致性。必须在 decompose 之后、estimate_hours 之前调用。最多调用 2 次，超过后需直接调用 estimate_hours 生成报价。需求详细时检查是否存在遗漏、重复、无中生有或与原需求不一致的情况。不通过则需修正后重新评估。",
      schema: z.object({}),
    },
  );
}

function buildGrillMeTool(model: BaseChatModel) {
  return tool(
    async ({ context }: { context?: string }, config?: RunnableConfig) => {
      const sessionId = getSessionId(config);
      const cache = getOrCreateSessionCache(sessionId);

      const contentToCheck = context?.trim() || cache.structuredBrief;
      if (!contentToCheck) {
        return JSON.stringify({
          isComplete: false,
          output: "尚未收集到任何需求信息。请先与用户沟通、解析文件，然后将已收集的需求信息作为 context 参数传入 grill_me。",
        });
      }

      logger.info("grill_me called", { sessionId, hasBrief: !!cache.structuredBrief, hasContext: !!context });
      const sessionConfig = getSessionConfig(sessionId);
      const overrideGrillMe = sessionConfig.promptOverrides?.grill_me;
      const skillContent = overrideGrillMe?.trim() || loadSkillContent("grill-me");

      const grillAgent = createAgent({
        model,
        systemPrompt: skillContent,
      });

      const result = await grillAgent.invoke({
        messages: [
          new HumanMessage(`请检查以下需求的完整性：\n\n${contentToCheck}\n\n按grill-me格式输出。`),
        ],
      });

      // Reasoning models (deepseek-v4, etc.) return content as [{type:"reasoning",...},{type:"text",text:"..."}]
      const rawContent = result.messages?.at(-1)?.content;
      const output = typeof rawContent === "string"
        ? rawContent
        : Array.isArray(rawContent)
          ? (rawContent as Array<{ type: string; text?: string }>)
            .filter((b) => b.type === "text")
            .map((b) => b.text ?? "")
            .join("")
          : "";
      const isComplete = output.includes("需求完整") || output.includes("无需澄清");
      return JSON.stringify({ isComplete, output });
    },
    {
      name: "grill_me",
      description: "从7个维度检查需求完整性（范围、用户角色、功能、技术约束、第三方集成、数据规模、交付时间）。既可用于信息收集阶段辅助提问（传入 context 参数），也可用于简报生成后最终检查（无需参数）。",
      schema: z.object({
        context: z.string().optional().describe("当前已收集的需求信息文本。用于简报生成前进行需求澄清时传入；简报生成后调用时无需传入。"),
      }),
    },
  );
}

// ---------------------------------------------------------------------------
// Row reading tool — inspect rows by module or sub_module
// ---------------------------------------------------------------------------

function buildReadRowsTool() {
  return tool(
    async ({ module, sub_module }: { module?: string; sub_module?: string }, config?: RunnableConfig) => {
      const sessionId = getSessionId(config);
      const cache = getOrCreateSessionCache(sessionId);

      if (!cache.rows.length) {
        return JSON.stringify({ status: "ok", rows: [], totalRows: 0, message: "功能清单为空，请先完成功能拆解（调用 decompose）。" });
      }

      let filtered = cache.rows;

      if (module) {
        filtered = filtered.filter(r => r.module === module);
      }
      if (sub_module) {
        filtered = filtered.filter(r => r.sub_module === sub_module);
      }

      const isOverview = !module && !sub_module;

      const lines = filtered.map(r => {
        const prefix = `[${r.category === "design" ? "设计" : "功能"}] ${r.module}` +
          ` → ${r.sub_module} → ${r.function}` +
          (r.sub_function ? ` → ${r.sub_function}` : "");
        if (isOverview) return prefix;
        return prefix + `: ${r.description}` + (r.remark ? ` (备注: ${r.remark})` : "");
      });

      return JSON.stringify({
        status: "ok",
        matched: filtered.length,
        totalRows: cache.rows.length,
        rows: lines,
        ...(isOverview && { note: "概览模式已省略功能描述，按模块名/子模块名筛选后会显示完整信息。" }),
      });
    },
    {
      name: "read_rows",
      description: "按条件读取功能清单中的指定行。可通过模块名(module)、子模块名(sub_module)组合筛选。用于查看特定行的当前内容，或在调用 decompose 修改前确认要修改的行。",
      schema: z.object({
        module: z.string().optional().describe("按模块名筛选，如 'C端微信小程序'"),
        sub_module: z.string().optional().describe("按子模块名筛选，如 '订单管理'。可配合 module 参数精确过滤同名子模块"),
      }),
    },
  );
}

// ---------------------------------------------------------------------------
// Agent factory — caches compiled agent per (model, systemPrompt) pair
// ---------------------------------------------------------------------------

function hashPrompt(prompt: string): string {
  return Buffer.from(prompt).toString("base64").slice(0, 16);
}

function buildAgent(model: BaseChatModel, systemPrompt: string) {
  return createAgent({
    model,
    tools: [
      buildParseFilesTool(),
      buildQueryFileTool(),
      buildGrillMeTool(model),
      buildDecomposeTool(model),
      buildReadRowsTool(),
      buildEvaluateTool(model),
      buildEstimateHoursTool(model),
    ],
    systemPrompt,
    middleware: [createModelLoggingMiddleware("main")],
    checkpointer: sharedCheckpointer,
  });
}

// ---------------------------------------------------------------------------
// Public API — lightweight entry point (no heavy construction)
// ---------------------------------------------------------------------------

export interface CreateMainAgentInput {
  model: BaseChatModel;
  attachments: Attachment[];
  sessionId?: string;
}

export function createPresalesAgent(input: CreateMainAgentInput) {
  const sessionId = input.sessionId || "default";
  const cache = getOrCreateSessionCache(sessionId);
  ingestAttachments(cache, input.attachments);

  const modelKey = getModelKey(input.model);
  const sessionConfig = getSessionConfig(sessionId);
  const effectivePrompt = resolvePrompt("main", sessionConfig.promptOverrides);
  const cacheKey = `${modelKey}__${hashPrompt(effectivePrompt)}`;

  if (!agentCache.has(cacheKey)) {
    agentCache.set(cacheKey, buildAgent(input.model, effectivePrompt));
    logger.info("agent created and cached", { modelKey, promptHash: hashPrompt(effectivePrompt) });
  }

  return agentCache.get(cacheKey)!;
}
