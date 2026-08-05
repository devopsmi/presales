import { createAgent } from "langchain";
import { HumanMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { DecomposerTree } from "./table";
import type { LevelRow } from "./table";
import { createModelLoggingMiddleware, createDeepseekThinkingMiddleware, extractStringContent } from "@/lib/agent/llm";
import {
  buildR1Tools,
  buildR2Tools,
  buildR3Tools,
  buildR4Tools,
  createDecomposerToolMiddleware,
  formatModuleList,
} from "./tools";
import log from "@/lib/logger";

const logger = log.child({ agent: "decomposer" });

function firstLine(s: string): string {
  const end = s.indexOf("\n");
  const line = end === -1 ? s : s.slice(0, end);
  if (end === -1) return line;
  return `${line}… (${s.length} chars)`;
}

type AnyAgent = ReturnType<typeof createAgent>;

function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as any)?.code ?? (err as any)?.status ?? "";

  if (String(code).includes("503")) return true;
  if (String(code).includes("429")) return true;
  if (msg.includes("503")) return true;
  if (msg.includes("429")) return true;
  if (msg.includes("rate") || msg.includes("Rate")) return true;
  if (msg.includes("busy") || msg.includes("Busy")) return true;
  if (msg.includes("unavailable") || msg.includes("Unavailable")) return true;
  if (msg.includes("timeout") || msg.includes("Timeout")) return true;
  if (msg.includes("ECONNRESET") || msg.includes("ETIMEDOUT") || msg.includes("ECONNREFUSED")) return true;
  return false;
}

async function invokeWithRetry(
  agentName: string,
  agent: AnyAgent,
  userPrompt: string,
  recursionLimit: number,
  maxRetries = 3,
  baseDelayMs = 1000,
): Promise<any> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await (agent as any).invoke(
        { messages: [new HumanMessage(userPrompt)] },
        { recursionLimit },
      );
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries) break;
      if (!isTransientError(err)) break;

      const delay = baseDelayMs * Math.pow(2, attempt);
      logger.warn(`${agentName} attempt ${attempt + 1} failed (retrying in ${delay}ms)`, {
        error: err instanceof Error ? err.message : String(err),
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

type LevelPromptCtx = {
  brief: string;
  instruction?: string;
};

function buildR1UserPrompt(modules: string[], ctx: LevelPromptCtx): string {
  const parts: string[] = [];
  parts.push(`## 项目简报\n${ctx.brief}\n`);

  if (ctx.instruction) {
    parts.push(`## 当前模块列表\n${formatModuleList(modules)}\n`);
    parts.push(`## 修改指令\n${ctx.instruction}\n`);
  } else if (modules.length > 0) {
    parts.push(`## 当前模块列表\n${formatModuleList(modules)}\n`);
  } else {
    parts.push("## 当前状态\n暂无模块，需要全新拆解。\n");
  }

  parts.push(
    "## 任务\n请根据项目简报，使用工具维护一级模块列表。" +
    "如果是全新拆解，请用 add_modules 添加模块；如果是修改轮，请按修改指令调整。" +
    "完成后调用 read_modules 确认结果。",
  );
  return parts.join("\n");
}

function buildR2UserPrompt(
  modules: string[],
  existingSubs: { module: string; sub_module: string }[],
  ctx: LevelPromptCtx,
): string {
  const parts: string[] = [];
  parts.push(`## 项目简报\n${ctx.brief}\n`);
  parts.push(`## 已有模块\n${formatModuleList(modules)}\n`);

  const subsByMod = new Map<string, string[]>();
  for (const { module, sub_module } of existingSubs) {
    const arr = subsByMod.get(module) ?? [];
    arr.push(sub_module);
    subsByMod.set(module, arr);
  }
  if (existingSubs.length > 0) {
    const subLines: string[] = [];
    for (const mod of modules) {
      const subs = subsByMod.get(mod);
      if (subs?.length) {
        subLines.push(`### ${mod}`);
        for (const s of subs) subLines.push(`  - ${s}`);
      } else {
        subLines.push(`### ${mod}\n  (暂无子模块)`);
      }
    }
    parts.push(`## 当前子模块\n${subLines.join("\n")}\n`);
  } else {
    parts.push("## 当前状态\n暂无子模块，需要为各模块拆解。\n");
  }

  if (ctx.instruction) {
    parts.push(`## 修改指令\n${ctx.instruction}\n`);
  }

  parts.push(
    "## 任务\n请根据项目简报和已有模块，为每个模块拆解子模块。" +
    "使用 add_sub_modules 逐模块添加。如果某模块或子模块是纯文档/设计的辅助域（非开发交付范畴），请使用 mark_module_support 或 mark_sub_module_support 标记。含接口定义/API文档等开发产出的为开发模块，正常拆解。" +
    "完成后调用 read_sub_modules 确认。",
  );
  return parts.join("\n");
}

function buildR3UserPrompt(
  contextRows: LevelRow[],
  ctx: LevelPromptCtx,
): string {
  const parts: string[] = [];
  parts.push(`## 项目简报\n${ctx.brief}\n`);

  const grouped = new Map<string, string[]>();
  for (const r of contextRows) {
    const key = `${r.module} → ${r.sub_module}`;
    const arr = grouped.get(key) ?? [];
    if (r.function) arr.push(r.function);
    grouped.set(key, arr);
  }

  const contextLines: string[] = [];
  for (const [key, funcs] of grouped) {
    contextLines.push(`### ${key}`);
    if (funcs.length > 0) {
      for (const f of funcs) contextLines.push(`  - ${f}`);
    } else {
      contextLines.push("  (暂无功能点)");
    }
  }
  parts.push(
    `## 当前状态（以下子模块需要拆解功能）\n${contextLines.join("\n")}\n`,
  );

  if (ctx.instruction) {
    parts.push(`## 修改指令\n${ctx.instruction}\n`);
  }

  parts.push(
    "## 任务\n请根据项目简报，为上述每个子模块识别功能点。" +
    "使用 add_functions 逐个子模块添加。完成后调用 read_functions 确认。",
  );
  return parts.join("\n");
}

function buildR4UserPrompt(
  rows: LevelRow[],
  module: string,
  subModule: string,
  ctx: LevelPromptCtx,
): string {
  const parts: string[] = [];
  parts.push(`## 项目简报\n${ctx.brief}\n`);
  parts.push(`## 当前拆解路径：${module} → ${subModule}\n`);

  const funcMap = new Map<
    string,
    { sub_function: string; description: string }[]
  >();
  for (const r of rows) {
    if (!r.function) continue;
    const leaves = funcMap.get(r.function) ?? [];
    if (r.sub_function) {
      leaves.push({
        sub_function: r.sub_function,
        description: r.description ?? "",
      });
    }
    funcMap.set(r.function, leaves);
  }

  const stateLines: string[] = [];
  for (const [func, leaves] of funcMap) {
    stateLines.push(`### ${func}`);
    if (leaves.length > 0) {
      for (const lf of leaves) {
        stateLines.push(`  - ${lf.sub_function}: ${lf.description}`);
      }
    } else {
      stateLines.push("  (暂无子功能)");
    }
  }
  parts.push(`## 当前状态\n${stateLines.join("\n")}\n`);

  if (ctx.instruction) {
    parts.push(`## 修改指令（仅应用于 ${module} → ${subModule}，不操作其他模块/子模块）\n${ctx.instruction}\n`);
  }

  parts.push(
    "## 任务\n请为上述功能生成子功能及描述。" +
    "对于已有的叶子，如修改指令要求则调整，否则保持不变。" +
    "对于空的功能，请使用 add_leaves 添加子功能。" +
    "完成后调用 read_leaves 确认。",
  );
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RoundResult {
  changedIds: number[];
  rowCount: number;
}

export async function runR1Agent(
  model: BaseChatModel,
  table: DecomposerTree,
  brief: string,
  systemPrompt: string,
  instruction?: string,
): Promise<RoundResult> {
  const beforeSnap = table.buildLevelSnapshot(1);
  const userPrompt = buildR1UserPrompt(table.getModuleNames(), { brief, instruction });

  logger.info("decomposer_r1 start", {
    sys: firstLine(systemPrompt),
    prompt: firstLine(userPrompt),
  });

  const agent = createAgent({
    model,
    systemPrompt,
    tools: buildR1Tools(table),
    middleware: [
      createDeepseekThinkingMiddleware(),
      createModelLoggingMiddleware("decomposer_r1"),
      createDecomposerToolMiddleware("decomposer_r1", table, 1, logger),
    ],
  });

  const result = await invokeWithRetry(
    "decomposer_r1",
    agent,
    userPrompt,
    12,
  );

  const output = extractStringContent(result.messages?.at(-1)?.content);
  logger.info("decomposer_r1 complete", {
    out: firstLine(output ?? ""),
  });

  const afterSnap = table.buildLevelSnapshot(1);
  const changedIds = DecomposerTree.diffSnapshots(beforeSnap, afterSnap);

  return { changedIds, rowCount: afterSnap.size };
}

export async function runR2Agent(
  model: BaseChatModel,
  table: DecomposerTree,
  brief: string,
  systemPrompt: string,
  instruction?: string,
): Promise<RoundResult> {
  const beforeSnap = table.buildLevelSnapshot(2);
  const userPrompt = buildR2UserPrompt(table.getModuleNames(), table.getSubModulePairs(), {
    brief,
    instruction,
  });

  logger.info("decomposer_r2 start", {
    sys: firstLine(systemPrompt),
    prompt: firstLine(userPrompt),
  });

  const agent = createAgent({
    model,
    systemPrompt,
    tools: buildR2Tools(table),
    middleware: [
      createDeepseekThinkingMiddleware(),
      createModelLoggingMiddleware("decomposer_r2"),
      createDecomposerToolMiddleware("decomposer_r2", table, 2, logger),
    ],
  });

  const result = await invokeWithRetry(
    "decomposer_r2",
    agent,
    userPrompt,
    15,
  );

  const output = extractStringContent(result.messages?.at(-1)?.content);
  logger.info("decomposer_r2 complete", {
    out: firstLine(output ?? ""),
  });

  const afterSnap = table.buildLevelSnapshot(2);
  const changedIds = DecomposerTree.diffSnapshots(beforeSnap, afterSnap);

  return { changedIds, rowCount: afterSnap.size };
}

export async function runR3Agent(
  model: BaseChatModel,
  table: DecomposerTree,
  brief: string,
  contextRows: LevelRow[],
  systemPrompt: string,
  instruction?: string,
): Promise<RoundResult> {
  const beforeSnap = table.buildLevelSnapshot(3);
  const userPrompt = buildR3UserPrompt(contextRows, { brief, instruction });

  logger.info("decomposer_r3 start", {
    sys: firstLine(systemPrompt),
    prompt: firstLine(userPrompt),
  });

  const agent = createAgent({
    model,
    systemPrompt,
    tools: buildR3Tools(table),
    middleware: [
      createDeepseekThinkingMiddleware(),
      createModelLoggingMiddleware("decomposer_r3"),
      createDecomposerToolMiddleware("decomposer_r3", table, 3, logger),
    ],
  });

  const result = await invokeWithRetry(
    "decomposer_r3",
    agent,
    userPrompt,
    20,
  );

  const output = extractStringContent(result.messages?.at(-1)?.content);
  logger.info("decomposer_r3 complete", {
    out: firstLine(output ?? ""),
  });

  const afterSnap = table.buildLevelSnapshot(3);
  const changedIds = DecomposerTree.diffSnapshots(beforeSnap, afterSnap);

  return { changedIds, rowCount: afterSnap.size };
}

export async function runR4AgentForSubModule(
  model: BaseChatModel,
  table: DecomposerTree,
  module: string,
  subModule: string,
  rows: LevelRow[],
  brief: string,
  systemPrompt: string,
  instruction: string | undefined,
  agentIndex: number,
  totalAgents: number,
): Promise<RoundResult> {
  const agentPrefix = `R4 #${agentIndex}/${totalAgents}`;
  const agentLabel = `${agentPrefix} ${module}→${subModule}`;
  const agentLogger = logger.child({
    agent: `r4_${agentIndex}/${totalAgents}`,
    module,
    subModule,
  });

  const beforeSnap = table.buildLevelSnapshot(4, { module, subModule });
  const userPrompt = buildR4UserPrompt(rows, module, subModule, {
    brief,
    instruction,
  });

  agentLogger.info(`${agentLabel} start`, {
    sys: firstLine(systemPrompt),
    prompt: firstLine(userPrompt),
  });

  const agent = createAgent({
    model,
    systemPrompt,
    tools: buildR4Tools(table),
    middleware: [
      createDeepseekThinkingMiddleware(),
      createModelLoggingMiddleware(`r4[${agentIndex}/${totalAgents}]`),
      createDecomposerToolMiddleware(`${agentPrefix} ${module}→${subModule}`, table, 4, agentLogger),
    ],
  });

  const t0 = Date.now();
  const result = await invokeWithRetry(
    `decomposer_r4_${agentIndex}`,
    agent,
    userPrompt,
    20,
  );
  const elapsed = Date.now() - t0;

  const output = extractStringContent(result.messages?.at(-1)?.content);

  const afterSnap = table.buildLevelSnapshot(4, { module, subModule });
  const changedIds = DecomposerTree.diffSnapshots(beforeSnap, afterSnap);

  agentLogger.info(`${agentLabel} complete (${elapsed}ms)`, {
    rowCount: afterSnap.size,
    changedIds: changedIds.length,
    out: firstLine(output ?? ""),
  });

  return { changedIds, rowCount: afterSnap.size };
}
