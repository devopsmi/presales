/**
 * Main Agent — presales orchestration via LangChain createAgent (Subagent pattern).
 *
 * Exposes 4 tools (3 sub-agents + grill-me) to the LLM.
 * Uses stage-tracking middleware to enforce sequential execution.
 *
 * Tools:
 *   parse_files    → FileParser sub-agent
 *   decompose      → Decomposer sub-agent
 *   estimate_hours → Estimator sub-agent
 *   grill_me       → loads grill-me skill, runs clarification check
 */
import fs from "fs";
import path from "path";
import { createAgent, tool, createMiddleware } from "langchain";
import { MemorySaver } from "@langchain/langgraph";
import { ToolMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Attachment } from "@/lib/types";
import type { TradeRole } from "@/lib/constants";
import { TRADE_DAILY_RATES } from "@/lib/constants";
import type { QuotationRow, QuotationHeader } from "@/lib/types";
import type { PipelineStage, StoredFile } from "@/lib/agent/state";
import { runFileParser } from "@/lib/agent/sub-agents/file-parser";
import { runDecomposer } from "@/lib/agent/sub-agents/decomposer";
import { runEstimator } from "@/lib/agent/sub-agents/estimator";
import log from "@/lib/logger";
import { createModelLoggingMiddleware } from "@/lib/agent/llm";

const logger = log.child({ agent: "main" });

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
    const existing = Array.from(cache.fileStore.values()).find((f) => f.name === att.name && f.body === att.rawData);
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

function buildFileListHint(cache: PipelineCache): string {
  const all = Array.from(cache.fileStore.values());
  if (!all.length) return "";
  const unparsed = all.filter((f) => !f.parsed);
  const parsed = all.filter((f) => f.parsed);
  const parts: string[] = [];
  if (unparsed.length) parts.push(`待解析：${unparsed.map((f) => `[${f.index}] ${f.name}`).join(" ")}`);
  if (parsed.length) parts.push(`已解析：${parsed.map((f) => `[${f.index}] ${f.name}`).join(" ")}`);
  return `当前文件：${parts.join("  ")}。`;
}

export function clearSessionCache(sessionId: string): boolean {
  return sessionCaches.delete(sessionId);
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
// Pipeline cache — shared across tool calls via closure
// ---------------------------------------------------------------------------

interface PipelineCache {
  stage: PipelineStage;
  structuredBrief: string;
  customerName: string;
  projectName: string;
  rows: QuotationRow[];
  header: QuotationHeader | null;
  fileStore: Map<number, StoredFile>;
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
    const rate = TRADE_DAILY_RATES[trade as TradeRole] ?? 2000;
    totalCost += manDays * rate;
  }

  const [bMin, bMax] = budgetRange;
  let budgetAdvice = "未设置预算";
  if (bMin > 0 || bMax > 0) {
    if (totalCost <= bMax && totalCost >= bMin)
      budgetAdvice = `总报价 ${totalCost.toLocaleString()} 元在预算范围内`;
    else if (totalCost < bMin)
      budgetAdvice = `总报价 ${totalCost.toLocaleString()} 元低于预算下限`;
    else
      budgetAdvice = `总报价 ${totalCost.toLocaleString()} 元超出预算上限`;
  }

  const trades = new Set<TradeRole>();
  for (const row of rows)
    for (const key of Object.keys(row.trades) as TradeRole[])
      if (row.trades[key] != null) trades.add(key);

  return { header, rows, trades: Array.from(trades), tradeTotals, totalCost, budgetAdvice };
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const MAIN_SYSTEM_PROMPT = `你是售前方案主管 Agent，负责与客户沟通并调度子Agent完成报价。

## 决策流程
1. 检查 query_file 工具描述中是否有待解析文件 → 有则调用 parse_files 解析
2. 收集信息：用户描述 + 已解析文件内容（用 query_file 逐文件查看）
3. 评估信息是否足够生成完整简报。如不足：
   - 用 grill_me 检视缺失维度
   - 主动向用户提问补充
   - 反复此过程直到信息充分
4. 信息足够后，汇总生成结构化简报，调用 write_brief 保存
5. 调用 decompose 拆解功能清单
6. 调用 estimate_hours 生成报价

## 工具说明
- **parse_files**: 启动文件解析子Agent，逐文件读取文本并保存摘要。有未解析文件时调用。
- **query_file**: 查看指定文件索引的已解析内容，阅读文件需求细节。
- **write_brief**: 保存结构化需求简报（Markdown）。格式需包含：项目标题、客户信息（名称+行业）、项目概述、核心模块列表、技术要求、交付要求。在信息收集充分后调用。
- **grill_me**: 从7个维度检查需求完整性（范围、用户角色、功能、技术约束、第三方集成、数据规模、交付时间）。既可用于 write_brief 后的最终检查，也可用于信息收集阶段辅助提问。
- **decompose**: 将需求简报拆解为五级功能清单。必须在 write_brief 后调用。
- **estimate_hours**: 估算工时并生成报价。必须在 decompose 后调用。

## 核心原则
- demand-driven: 只在需要时解析文件、只在信息不足时追问
- 最终报价以 estimate_hours 的输出为准`;

// ---------------------------------------------------------------------------
// Tool builders
// ---------------------------------------------------------------------------

function buildParseFilesTool(
  model: BaseChatModel,
  cache: PipelineCache,
) {
  const fileHint = buildFileListHint(cache);
  return tool(
    async ({ rawText }: { rawText: string }) => {
      logger.info("parse_files called");
      await runFileParser(model, cache.fileStore);

      cache.stage = "parsed";

      const all = Array.from(cache.fileStore.values());
      const parsed = all.filter((f) => f.parsed);
      const unparsed = all.filter((f) => !f.parsed);

      return JSON.stringify({
        status: "ok",
        parsedCount: parsed.length,
        unparsedCount: unparsed.length,
        message: parsed.length > 0
          ? `文件解析完成：${parsed.length} 个已解析。${unparsed.length ? ` ${unparsed.length} 个解析失败。` : ""}请使用 query_file 查看各文件内容并汇总需求简报。`
          : "没有文件需要解析。",
      });
    },
    {
      name: "parse_files",
      description: `启动文件解析子Agent，逐一解析待解析文件的文本内容。${fileHint}参数 rawText 为用户的完整原始需求描述。`,
      schema: z.object({
        rawText: z.string().describe("用户的完整原始需求描述文本"),
      }),
    },
  );
}

function buildQueryFileTool(cache: PipelineCache) {
  const fileList = Array.from(cache.fileStore.values())
    .map((f) => `[${f.index}] ${f.name}${f.parsed ? "✓" : ""}`)
    .join(" ");
  return tool(
    async ({ index }: { index: number }) => {
      const file = cache.fileStore.get(index);
      if (!file) return JSON.stringify({ error: `文件索引 ${index} 不存在` });
      if (!file.parsed) return JSON.stringify({ name: file.name, type: file.type, index, parsed: false, hint: "尚未解析，请先调用 parse_files" });
      return JSON.stringify({ name: file.name, type: file.type, index, parsed: true, content: file.parsed });
    },
    {
      name: "query_file",
      description: `查询指定文件索引的已解析内容。可用文件: ${fileList || "无"}。✓表示已解析。参数为文件索引号。`,
      schema: z.object({ index: z.number().describe("文件索引号") }),
    },
  );
}

function buildWriteBriefTool(cache: PipelineCache) {
  return tool(
    async ({ summary }: { summary: string }) => {
      const customerName = summary.match(/客户名称[：:]\s*(.+)/)?.[1]?.trim() ?? "未指定客户";
      const projectName = summary.match(/^##\s*(.+)/m)?.[1]?.trim() ?? "未指定项目";
      cache.structuredBrief = summary;
      cache.customerName = customerName;
      cache.projectName = projectName;
      logger.info("brief written", { customerName, projectName, length: summary.length });
      return JSON.stringify({
        status: "ok",
        customerName,
        projectName,
        length: summary.length,
        message: `需求简报已保存。客户：${customerName}，项目：${projectName}`,
      });
    },
    {
      name: "write_brief",
      description: "保存结构化的需求简报。在汇总用户需求和文件内容后调用。只需传入完整的 Markdown 格式简报。",
      schema: z.object({
        summary: z.string().describe("结构化的需求简报，Markdown 格式，包含项目标题、客户信息、项目概述、核心模块、技术要求、交付要求"),
      }),
    },
  );
}

function buildDecomposeTool(model: BaseChatModel, cache: PipelineCache) {
  return tool(
    async () => {
      if (!cache.structuredBrief) {
        return JSON.stringify({ status: "error", message: "请先汇总需求简报（调用 write_brief）" });
      }
      logger.info("decompose called");
      const result = await runDecomposer(model, { structuredBrief: cache.structuredBrief });

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
      description: "将需求简报拆解为五级功能清单。必须在 parse_files 后调用。无需参数。",
      schema: z.object({}),
    },
  );
}

function buildEstimateHoursTool(
  model: BaseChatModel,
  cache: PipelineCache,
  selectedTrades: TradeRole[],
  budgetRange: [number, number],
  vendorName: string,
) {
  return tool(
    async () => {
      if (cache.stage !== "decomposed") {
        return JSON.stringify({ status: "error", message: "请先完成功能拆解" });
      }
      if (!cache.rows.length) {
        return JSON.stringify({ status: "error", message: "功能清单为空" });
      }
      logger.info("estimate_hours called", { rowCount: cache.rows.length });

      const result = await runEstimator(model, {
        rows: cache.rows,
        selectedTrades,
        estimationPlanId: "default-plan",
        customerName: cache.customerName,
        projectName: cache.projectName,
        vendorName,
        budgetRange,
      });

      cache.stage = "estimated";
      cache.rows = result.rows;
      cache.header = result.header;

      const quotation = computeQuotationResult(result.rows, result.header, selectedTrades, budgetRange);
      return JSON.stringify(quotation);
    },
    {
      name: "estimate_hours",
      description: "为功能清单估算各工种人天并自动计算报价。必须在 decompose 后调用。无需参数。",
      schema: z.object({}),
    },
  );
}

function buildGrillMeTool(model: BaseChatModel, cache: PipelineCache) {
  return tool(
    async () => {
      if (!cache.structuredBrief) {
        return JSON.stringify({ isComplete: true, output: "尚未解析需求，请先调用 parse_files。" });
      }
      logger.info("grill_me called");
      const skillContent = loadSkillContent("grill-me");

      const grillAgent = createAgent({
        model,
        systemPrompt: skillContent,
      });

      const result = await grillAgent.invoke({
        messages: [{ role: "user", content: `请检查以下需求的完整性：\n\n${cache.structuredBrief}\n\n按grill-me格式输出。` }],
      });

      const output = typeof result.messages?.at(-1)?.content === "string"
        ? result.messages.at(-1)!.content as string
        : "";
      const isComplete = output.includes("需求完整") || output.includes("无需澄清");
      return JSON.stringify({ isComplete, output });
    },
    {
      name: "grill_me",
      description: "检查需求完整性，识别模糊点。在 parse_files 后可选调用。无需参数。",
      schema: z.object({}),
    },
  );
}

// ---------------------------------------------------------------------------
// Stage tracking middleware
// ---------------------------------------------------------------------------

function createStageTracker(cache: PipelineCache) {
  return createMiddleware({
    name: "StageTracker",
    wrapToolCall: async (request: any, handler: any) => {
      const toolName = request.toolCall?.name;
      const currentStage = cache.stage;

      const order: Record<string, PipelineStage> = {
        parse_files: "idle",
        decompose: "parsed",
        estimate_hours: "decomposed",
      };

      const required = order[toolName];
      if (required) {
        const stageOrder: PipelineStage[] = ["idle", "parsed", "decomposed", "estimated"];
        const currentIdx = stageOrder.indexOf(currentStage);
        const requiredIdx = stageOrder.indexOf(required);
        if (currentIdx < requiredIdx) {
          const labels: Record<PipelineStage, string> = {
            idle: "初始", parsed: "文件解析", decomposed: "功能拆解", estimated: "已完成",
          };
          return new ToolMessage({
            content: `无法执行 "${toolName}"：需要先完成${labels[required]}（当前: ${labels[currentStage]}）`,
            tool_call_id: request.toolCall?.id ?? "",
          });
        }
      }

      return handler(request);
    },
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface CreateMainAgentInput {
  model: BaseChatModel;
  selectedTrades: TradeRole[];
  budgetRange: [number, number];
  vendorName: string;
  attachments: Attachment[];
  sessionId?: string;
}

export function createPresalesAgent(input: CreateMainAgentInput) {
  const cache = getOrCreateSessionCache(input.sessionId || "default");
  ingestAttachments(cache, input.attachments);

  const parseFilesTool = buildParseFilesTool(input.model, cache);
  const queryFileTool = buildQueryFileTool(cache);
  const decomposeTool = buildDecomposeTool(input.model, cache);
  const estimateHoursTool = buildEstimateHoursTool(
    input.model, cache, input.selectedTrades, input.budgetRange, input.vendorName,
  );
  const grillMeTool = buildGrillMeTool(input.model, cache);

  const stageTracker = createStageTracker(cache);

  const agent = createAgent({
    model: input.model,
    tools: [parseFilesTool, queryFileTool, buildWriteBriefTool(cache), grillMeTool, decomposeTool, estimateHoursTool],
    systemPrompt: MAIN_SYSTEM_PROMPT,
    middleware: [stageTracker, createModelLoggingMiddleware("main")],
    checkpointer: new MemorySaver(),
  });

  return agent;
}
