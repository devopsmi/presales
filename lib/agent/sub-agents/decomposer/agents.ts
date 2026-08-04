import { createAgent } from "langchain";
import { HumanMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { DecomposerTable } from "./table";
import type { LevelRow } from "./table";
import { createModelLoggingMiddleware, extractStringContent } from "@/lib/agent/llm";
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
    "使用 add_sub_modules 逐模块添加。支撑辅助域（如设计文档）不拆分。" +
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
    parts.push(`## 修改指令\n${ctx.instruction}\n`);
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
  changedIndices: number[];
  rowCount: number;
}

export async function runR1Agent(
  model: BaseChatModel,
  table: DecomposerTable,
  brief: string,
  systemPrompt: string,
  instruction?: string,
): Promise<RoundResult> {
  const beforeSnap = table.buildLevelSnapshot(1);
  const userPrompt = buildR1UserPrompt(table.getModules(), { brief, instruction });

  logger.info("decomposer_r1 start", {
    sys: firstLine(systemPrompt),
    prompt: firstLine(userPrompt),
  });

  const agent = createAgent({
    model,
    systemPrompt,
    tools: buildR1Tools(table),
    middleware: [
      createModelLoggingMiddleware("decomposer_r1"),
      createDecomposerToolMiddleware("decomposer_r1", table, 1, logger),
    ],
  });

  const result = await agent.invoke(
    { messages: [new HumanMessage(userPrompt)] },
    { recursionLimit: 12 },
  );

  const output = extractStringContent(result.messages?.at(-1)?.content);
  logger.info("decomposer_r1 complete", {
    out: firstLine(output ?? ""),
  });

  const afterSnap = table.buildLevelSnapshot(1);
  const changedIndices = DecomposerTable.diffSnapshots(beforeSnap, afterSnap);

  return { changedIndices, rowCount: afterSnap.size };
}

export async function runR2Agent(
  model: BaseChatModel,
  table: DecomposerTable,
  brief: string,
  systemPrompt: string,
  instruction?: string,
): Promise<RoundResult> {
  const beforeSnap = table.buildLevelSnapshot(2);
  const userPrompt = buildR2UserPrompt(table.getModules(), table.getSubModules(), {
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
      createModelLoggingMiddleware("decomposer_r2"),
      createDecomposerToolMiddleware("decomposer_r2", table, 2, logger),
    ],
  });

  const result = await agent.invoke(
    { messages: [new HumanMessage(userPrompt)] },
    { recursionLimit: 15 },
  );

  const output = extractStringContent(result.messages?.at(-1)?.content);
  logger.info("decomposer_r2 complete", {
    out: firstLine(output ?? ""),
  });

  const afterSnap = table.buildLevelSnapshot(2);
  const changedIndices = DecomposerTable.diffSnapshots(beforeSnap, afterSnap);

  return { changedIndices, rowCount: afterSnap.size };
}

export async function runR3Agent(
  model: BaseChatModel,
  table: DecomposerTable,
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
      createModelLoggingMiddleware("decomposer_r3"),
      createDecomposerToolMiddleware("decomposer_r3", table, 3, logger),
    ],
  });

  const result = await agent.invoke(
    { messages: [new HumanMessage(userPrompt)] },
    { recursionLimit: 20 },
  );

  const output = extractStringContent(result.messages?.at(-1)?.content);
  logger.info("decomposer_r3 complete", {
    out: firstLine(output ?? ""),
  });

  const afterSnap = table.buildLevelSnapshot(3);
  const changedIndices = DecomposerTable.diffSnapshots(beforeSnap, afterSnap);

  return { changedIndices, rowCount: afterSnap.size };
}

export async function runR4AgentForSubModule(
  model: BaseChatModel,
  table: DecomposerTable,
  module: string,
  subModule: string,
  rows: LevelRow[],
  brief: string,
  systemPrompt: string,
  instruction?: string,
): Promise<RoundResult> {
  const beforeSnap = table.buildLevelSnapshot(4, { module, subModule });
  const userPrompt = buildR4UserPrompt(rows, module, subModule, {
    brief,
    instruction,
  });

  logger.info("decomposer_r4 start", {
    module,
    subModule,
    sys: firstLine(systemPrompt),
    prompt: firstLine(userPrompt),
  });

  const agent = createAgent({
    model,
    systemPrompt,
    tools: buildR4Tools(table),
    middleware: [
      createModelLoggingMiddleware("decomposer_r4"),
      createDecomposerToolMiddleware("decomposer_r4", table, 4, logger),
    ],
  });

  const result = await agent.invoke(
    { messages: [new HumanMessage(userPrompt)] },
    { recursionLimit: 20 },
  );

  const output = extractStringContent(result.messages?.at(-1)?.content);
  logger.info("decomposer_r4 complete", {
    module,
    subModule,
    out: firstLine(output ?? ""),
  });

  const afterSnap = table.buildLevelSnapshot(4, { module, subModule });
  const changedIndices = DecomposerTable.diffSnapshots(beforeSnap, afterSnap);

  return { changedIndices, rowCount: afterSnap.size };
}
