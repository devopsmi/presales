/**
 * Decomposer SubAgent — BFS layer-by-layer decomposition.
 *
 * Breaks a structured brief into QuotationRow[] across 4 sequential LLM rounds:
 *   Round 1 (Module) → Round 2 (Sub-Module) → Round 3 (Function) → Round 4 (Leaf)
 *
 * Each round outputs compact {parent → children} mappings to minimize token waste.
 * Final stitch() reconstructs full QuotationRow[] from the forward-reference chain.
 */
import type { DecomposerProgress } from "@/lib/agent/state";
import { createAgent } from "langchain";
import { HumanMessage } from "@langchain/core/messages";
import fs from "fs";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { QuotationRow } from "@/lib/types";
import type { DecomposerOutput } from "@/lib/agent/state";
import { createModelLoggingMiddleware, extractStringContent } from "@/lib/agent/llm";
import { getSessionConfig } from "@/lib/session-config";
import { resolvePrompt } from "@/lib/prompt-defaults";
import log from "@/lib/logger";

const logger = log.child({ agent: "decomposer" });

// ===========================================================================
// Low-level LLM invoke — returns parsed JSON (array or object)
// ===========================================================================

async function invokeAndExtractJson(
  model: BaseChatModel,
  agentName: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<unknown> {
  logger.info(`${agentName} start`);

  const agent = createAgent({
    model,
    systemPrompt,
    middleware: [createModelLoggingMiddleware(agentName)],
  });

  const result = await agent.invoke({
    messages: [new HumanMessage(userPrompt)],
  });

  const output = extractStringContent(result.messages?.at(-1)?.content);
  if (!output) {
    const blocks = Array.isArray(result.messages?.at(-1)?.content)
      ? (result.messages!.at(-1)!.content as Array<{ type: string }>).map((b) => b.type).join(", ")
      : typeof result.messages?.at(-1)?.content;
    throw new Error(`Decomposer ${agentName}: empty output (blocks: ${blocks})`);
  }

  // Match either JSON object or JSON array.
  // Object MUST come first: if output is an object containing nested arrays,
  // the greedy array regex would grab from the first '[' to the last ']',
  // producing invalid JSON. Object regex has no such ambiguity.
  const objectMatch = output.match(/\{[\s\S]*\}/);
  const arrayMatch = output.match(/\[[\s\S]*\]/);
  const match = objectMatch ?? arrayMatch;
  if (!match) {
    const head = output.slice(0, 200);
    const tail = output.slice(-200);
    throw new Error(
      `Decomposer ${agentName}: no JSON found (len=${output.length}, head="${head}", tail="${tail}")`,
    );
  }

  let parsed: unknown;
  try { parsed = JSON.parse(match[0]); } catch (err) {
    const dumpFile = `/tmp/decomposer_${agentName}_${Date.now()}_raw.txt`;
    fs.writeFileSync(dumpFile, output, "utf-8");
    throw new Error(
      `Decomposer ${agentName}: JSON parse failed — ${String(err)}. Full output dumped to ${dumpFile} (${output.length} chars)`,
    );
  }

  logger.info(`${agentName} complete`);
  return parsed;
}

// ===========================================================================
// invokeRoundWithContext — injects instructions + previous rows into user prompt
// ===========================================================================

async function invokeRoundWithContext(
  model: BaseChatModel,
  agentName: string,
  systemPrompt: string,
  userPrompt: string,
  instructions?: string,
  previousRowsContext?: string,
): Promise<unknown> {
  const contextParts: string[] = [];
  if (instructions) {
    contextParts.push(`⚠️ 修改指令: ${instructions}\n请只修改指令指定的部分，其他部分保持与参考结构一致。`);
  }
  if (previousRowsContext) {
    contextParts.push(previousRowsContext);
  }

  const fullUserPrompt = contextParts.length > 0
    ? contextParts.join("\n\n") + "\n\n---\n\n" + userPrompt
    : userPrompt;

  return invokeAndExtractJson(model, agentName, systemPrompt, fullUserPrompt);
}

// ===========================================================================
// invokeRoundWithRetry — retries LLM call once on parse failure
// ===========================================================================

async function invokeRoundWithRetry<T>(
  model: BaseChatModel,
  agentName: string,
  systemPrompt: string,
  baseUserPrompt: string,
  parseFn: (raw: unknown) => T,
  instructions?: string,
  previousRowsContext?: string,
): Promise<T> {
  let userPrompt = baseUserPrompt;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await invokeRoundWithContext(
        model, agentName, systemPrompt, userPrompt,
        attempt === 0 ? instructions : undefined,
        attempt === 0 ? previousRowsContext : undefined,
      );
      return parseFn(raw);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);

      if (attempt === 0) {
        logger.warn(`${agentName} attempt 1 failed, retrying`, { error: errMsg });
        userPrompt = `${baseUserPrompt}\n\n⚠️ 上一次输出校验失败：${errMsg}\n请修正后重新输出。`;
      } else {
        throw err instanceof Error ? err : new Error(String(err));
      }
    }
  }

  throw new Error("unreachable");
}

// ===========================================================================
// Layer parsers / validators — no category, compact output
// ===========================================================================

function parseModules(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    throw new Error("Decomposer R1: expected JSON array");
  }
  const modules = raw.map((item, i) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`Decomposer R1: invalid module at index ${i} — must be non-empty string`);
    }
    return item.trim();
  });
  if (modules.length < 2) {
    throw new Error("Decomposer R1: expected at least 2 modules");
  }
  const dupes = modules.filter((m, i) => modules.indexOf(m) !== i);
  if (dupes.length > 0) {
    throw new Error(`Decomposer R1: duplicate modules — ${dupes.join(", ")}`);
  }
  return modules;
}

/**
 * Parses R2 output: {"模块A": ["子1","子2"], "模块B": ["子3"]}
 * Returns flat [module, sub_module] pairs.
 */
function parseSubModules(raw: unknown, parentModules: string[]): [string, string][] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Decomposer R2: expected JSON object (not array)");
  }
  const obj = raw as Record<string, unknown>;
  const pairs: [string, string][] = [];

  for (const [module, children] of Object.entries(obj)) {
    if (!parentModules.includes(module)) {
      throw new Error(`Decomposer R2: unknown module "${module}" — not in R1 output`);
    }
    if (!Array.isArray(children)) {
      throw new Error(`Decomposer R2: value for "${module}" is not an array`);
    }
    for (const child of children) {
      if (typeof child !== "string" || !child.trim()) {
        throw new Error(`Decomposer R2: invalid sub_module under "${module}"`);
      }
      pairs.push([module, child.trim()]);
    }
  }

  const covered = new Set(pairs.map((p) => p[0]));
  const missing = parentModules.filter((m) => !covered.has(m));
  if (missing.length > 0) {
    throw new Error(`Decomposer R2: missing sub-modules for: ${missing.join(", ")}`);
  }
  return pairs;
}

/**
 * Parses R3 output: {"子模块1": ["功能a","功能b"], "子模块2": ["功能c"]}
 * Returns flat [sub_module, function] pairs.
 */
function parseFunctions(
  raw: unknown,
  parentPairs: [string, string][],
): [string, string][] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Decomposer R3: expected JSON object (not array)");
  }
  const obj = raw as Record<string, unknown>;
  const pairs: [string, string][] = [];

  const parentSubModules = new Set(parentPairs.map((p) => p[1]));
  for (const [subModule, children] of Object.entries(obj)) {
    if (!parentSubModules.has(subModule)) {
      throw new Error(`Decomposer R3: unknown sub_module "${subModule}" — not in R2 output`);
    }
    if (!Array.isArray(children)) {
      throw new Error(`Decomposer R3: value for "${subModule}" is not an array`);
    }
    for (const child of children) {
      if (typeof child !== "string" || !child.trim()) {
        throw new Error(`Decomposer R3: invalid function under "${subModule}"`);
      }
      pairs.push([subModule, child.trim()]);
    }
  }

  const covered = new Set(pairs.map((p) => p[0]));
  const missing = [...parentSubModules].filter((s) => !covered.has(s));
  if (missing.length > 0) {
    throw new Error(`Decomposer R3: missing functions for: ${missing.join(", ")}`);
  }
  return pairs;
}

/**
 * Parses R4 output: {"功能a": {"子功能x":"描述x","子功能y":"描述y"}, ...}
 * Returns flat [function, sub_function, description] triples.
 */
function parseLeaves(
  raw: unknown,
  parentFuncs: [string, string][],
): [string, string, string][] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Decomposer R4: expected JSON object (not array)");
  }
  const obj = raw as Record<string, Record<string, unknown>>;
  const triples: [string, string, string][] = [];

  const parentFunctionSet = new Set(parentFuncs.map((p) => p[1]));

  for (const [func, children] of Object.entries(obj)) {
    if (!parentFunctionSet.has(func)) {
      throw new Error(`Decomposer R4: unknown function "${func}" — not in R3 output`);
    }
    if (!children || typeof children !== "object" || Array.isArray(children)) {
      throw new Error(`Decomposer R4: value for "${func}" is not an object`);
    }

    for (const [subFunc, desc] of Object.entries(children)) {
      if (typeof subFunc !== "string" || !subFunc.trim()) {
        throw new Error(`Decomposer R4: empty sub_function key under "${func}"`);
      }
      if (subFunc === func) {
        throw new Error(
          `Decomposer R4: sub_function "${subFunc}" must differ from function "${func}"`,
        );
      }
      if (typeof desc !== "string" || !desc.trim()) {
        throw new Error(`Decomposer R4: empty description for "${func}" → "${subFunc}"`);
      }
      triples.push([func, subFunc.trim(), desc.trim()]);
    }
  }

  if (triples.length === 0) {
    throw new Error("Decomposer R4: no valid leaf triples generated");
  }

  const covered = new Set(triples.map((t) => t[0]));
  const missing = [...parentFunctionSet].filter((f) => !covered.has(f));
  if (missing.length > 0) {
    throw new Error(`Decomposer R4: missing leaves for: ${missing.join(", ")}`);
  }

  return triples;
}

/**
 * Parses R4 output for a single sub-module.
 *
 * Supports two value formats:
 * - Business functions: {"func_a": {"leaf_x":"desc_x",...}}  → triples with sub_function
 * - Basic functions:    {"func_b": "desc"}                    → single triple, sub_function = func
 */
function parseLeavesForSubModule(
  raw: unknown,
  subModule: string,
  expectedFuncs: string[],
): [string, string, string][] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Decomposer R4 [${subModule}]: expected JSON object (not array)`);
  }
  const obj = raw as Record<string, unknown>;
  const triples: [string, string, string][] = [];

  for (const [func, children] of Object.entries(obj)) {
    if (!expectedFuncs.includes(func)) {
      throw new Error(
        `Decomposer R4 [${subModule}]: unknown function "${func}" — not in expected list`,
      );
    }

    // Basic (infrastructure) function: string value → single leaf, sub_func = func
    if (typeof children === "string") {
      const desc = children.trim();
      if (!desc) {
        throw new Error(`Decomposer R4 [${subModule}]: empty description for "${func}"`);
      }
      triples.push([func, func, desc]);
      continue;
    }

    if (!children || typeof children !== "object" || Array.isArray(children)) {
      throw new Error(
        `Decomposer R4 [${subModule}]: value for "${func}" must be an object or string`,
      );
    }

    // Business function: object value → sub_function leaves
    for (const [subFunc, desc] of Object.entries(children as Record<string, unknown>)) {
      if (typeof subFunc !== "string" || !subFunc.trim()) {
        throw new Error(`Decomposer R4 [${subModule}]: empty sub_function key under "${func}"`);
      }
      if (subFunc === func) {
        throw new Error(
          `Decomposer R4 [${subModule}]: sub_function "${subFunc}" must differ from function "${func}"`,
        );
      }
      if (typeof desc !== "string" || !desc.trim()) {
        throw new Error(`Decomposer R4 [${subModule}]: empty description for "${func}" → "${subFunc}"`);
      }
      triples.push([func, subFunc.trim(), desc.trim()]);
    }
  }

  if (triples.length === 0) {
    throw new Error(`Decomposer R4 [${subModule}]: no valid leaf triples generated`);
  }

  const covered = new Set(triples.map((t) => t[0]));
  const missing = expectedFuncs.filter((f) => !covered.has(f));
  if (missing.length > 0) {
    throw new Error(`Decomposer R4 [${subModule}]: missing leaves for: ${missing.join(", ")}`);
  }

  return triples;
}

// ===========================================================================
// Final stitch — reconstructs QuotationRow[] from the forward-reference chain
// ===========================================================================

function stitch(
  r2Pairs: [string, string][],       // [module, sub_module]
  r3Pairs: [string, string][],       // [sub_module, function]
  r4Triples: [string, string, string][], // [function, sub_function, description]
): QuotationRow[] {
  // R3: group functions by sub_module
  const r3Map = new Map<string, string[]>();
  for (const [sub, func] of r3Pairs) {
    let arr = r3Map.get(sub);
    if (!arr) r3Map.set(sub, arr = []);
    arr.push(func);
  }

  // R4: group leaves by function
  const r4Map = new Map<string, [string, string][]>();
  for (const [func, subFunc, desc] of r4Triples) {
    let arr = r4Map.get(func);
    if (!arr) r4Map.set(func, arr = []);
    arr.push([subFunc, desc]);
  }

  const rows: QuotationRow[] = [];
  for (const [module, sub] of r2Pairs) {           // R2: [module, sub_module]
    for (const func of r3Map.get(sub) ?? []) {     // R3: [function]
      for (const [subFunc, desc] of r4Map.get(func) ?? []) { // R4: [sub_func, desc]
        rows.push({
          seq: 0,
          module,
          sub_module: sub,
          function: func,
          sub_function: subFunc,
          description: desc,
          category: "feature",
          trades: {},
          remark: "",
        });
      }
    }
  }

  rows.forEach((r, i) => { r.seq = i + 1; });
  return rows;
}

// ===========================================================================
// Prompt builders — feed prior layer output + brief to each round
// ===========================================================================

function buildR2Prompt(modules: string[], brief: string): string {
  return [
    `模块列表（共 ${modules.length} 个）：`,
    JSON.stringify(modules),
    "",
    "项目简报：",
    brief,
    "",
    "请为每个模块拆解子模块。输出格式：{\"模块A\":[\"子1\",\"子2\"], \"模块B\":[\"子3\"]}",
  ].join("\n");
}

function buildR3Prompt(r2Pairs: [string, string][], brief: string): string {
  // Group sub-modules by module for context
  const moduleMap = new Map<string, string[]>();
  for (const [mod, sub] of r2Pairs) {
    if (!moduleMap.has(mod)) moduleMap.set(mod, []);
    moduleMap.get(mod)!.push(sub);
  }

  const hierarchy = [...moduleMap.entries()]
    .map(([mod, subs]) => `  ${mod} → ${subs.join("、")}`)
    .join("\n");

  // Extract unique sub-module names as JSON array for LLM reference
  const subNames = r2Pairs.map((p) => p[1]);

  return [
    "模块-子模块关系：",
    hierarchy,
    "",
    "项目简报：",
    brief,
    "",
    `请为以下 ${subNames.length} 个子模块识别功能点。输出格式：{"子模块名":["功能1","功能2"]}`,
    `子模块列表：${JSON.stringify(subNames)}`,
  ].join("\n");
}

function buildR4PromptForSubModule(
  module: string,
  subModule: string,
  funcs: string[],
  brief: string,
): string {
  return [
    `当前拆解路径：${module} → ${subModule}`,
    "",
    "项目简报：",
    brief,
    "",
    `请为子模块"${subModule}"下的 ${funcs.length} 个功能生成子功能和描述。输出格式：{"功能名":{"子功能名":"描述",...}}`,
    `功能列表：${JSON.stringify(funcs)}`,
  ].join("\n");
}

// ===========================================================================
// formatPreviousRows — reconstructs hierarchy tree from QuotationRow[] for LLM reference
// ===========================================================================

function formatPreviousRows(rows: QuotationRow[]): string {
  if (!rows.length) return "";

  const moduleMap = new Map<string, Map<string, Map<string, [string, string][]>>>();
  for (const r of rows) {
    if (!moduleMap.has(r.module)) moduleMap.set(r.module, new Map());
    const subMap = moduleMap.get(r.module)!;
    if (!subMap.has(r.sub_module)) subMap.set(r.sub_module, new Map());
    const funcMap = subMap.get(r.sub_module)!;
    if (!funcMap.has(r.function)) funcMap.set(r.function, []);
    funcMap.get(r.function)!.push([r.sub_function, r.description]);
  }

  const lines: string[] = [];
  lines.push(`## 参考：上一次拆解结果（共 ${rows.length} 个叶子行）`);
  lines.push("请在此结构基础上按修改指令调整，保持未涉及部分不变。");
  lines.push("");

  for (const [module, subMap] of moduleMap) {
    lines.push(`### ${module}`);
    for (const [sub, funcMap] of subMap) {
      lines.push(`  - ${sub}`);
      for (const [func, leaves] of funcMap) {
        lines.push(`    - ${func}`);
        for (const [subFunc, desc] of leaves) {
          lines.push(`      - ${subFunc}: ${desc}`);
        }
      }
    }
  }

  return lines.join("\n");
}

/**
 * Filters previousRows to only include rows for a specific sub_module,
 * keeping the module context header. Returns empty string if no rows match.
 */
function formatPreviousRowsForSubModule(rows: QuotationRow[], targetSubModule: string): string {
  const filtered = rows.filter((r) => r.sub_module === targetSubModule);
  if (!filtered.length) return "";

  const funcMap = new Map<string, [string, string][]>();
  for (const r of filtered) {
    if (!funcMap.has(r.function)) funcMap.set(r.function, []);
    funcMap.get(r.function)!.push([r.sub_function, r.description]);
  }

  const lines: string[] = [];
  const module = filtered[0].module;
  lines.push(`## 参考：上一次拆解结果（子模块"${targetSubModule}"，共 ${filtered.length} 个叶子行）`);
  lines.push("请在此结构基础上按修改指令调整，保持未涉及部分不变。");
  lines.push("");
  lines.push(`### ${module} → ${targetSubModule}`);
  for (const [func, leaves] of funcMap) {
    lines.push(`  - ${func}`);
    for (const [subFunc, desc] of leaves) {
      lines.push(`    - ${subFunc}: ${desc}`);
    }
  }

  return lines.join("\n");
}

// ===========================================================================
// invokeR4ForSubModule — runs a single sub-module's R4 round with retry
// ===========================================================================

async function invokeR4ForSubModule(
  model: BaseChatModel,
  agentName: string,
  systemPrompt: string,
  module: string,
  subModule: string,
  funcs: string[],
  brief: string,
  instructions?: string,
  previousRowsContext?: string,
): Promise<[string, string, string][]> {
  const baseUserPrompt = buildR4PromptForSubModule(module, subModule, funcs, brief);

  return invokeRoundWithRetry(
    model,
    agentName,
    systemPrompt,
    baseUserPrompt,
    (raw) => parseLeavesForSubModule(raw, subModule, funcs),
    instructions,
    previousRowsContext,
  );
}

// ===========================================================================
// BFS orchestrator — 4 rounds, each focusing on one hierarchy level
// ===========================================================================

export async function runDecomposer(
  model: BaseChatModel,
  sessionId: string,
  input: {
    structuredBrief: string;
    instructions?: string;
    previousRows?: QuotationRow[];
  },
  onProgress?: (progress: DecomposerProgress) => void,
): Promise<DecomposerOutput> {
  const brief = input.structuredBrief;
  if (!brief || !brief.trim()) {
    throw new Error("Decomposer: structuredBrief is empty");
  }

  const instructions = input.instructions;
  const previousRowsContext = input.previousRows?.length
    ? formatPreviousRows(input.previousRows)
    : undefined;

  logger.info("decomposer start (BFS)", {
    briefLen: brief.length,
    hasInstructions: !!instructions,
    hasPreviousRows: !!previousRowsContext,
  });

  const overrides = getSessionConfig(sessionId)?.promptOverrides;
  const r1Prompt = resolvePrompt("decomposer_r1", overrides);
  const r2Prompt = resolvePrompt("decomposer_r2", overrides);
  const r3Prompt = resolvePrompt("decomposer_r3", overrides);
  const r4Prompt = resolvePrompt("decomposer_r4", overrides);

  // ── Round 1: Modules (flat string array) ──
  onProgress?.({ stage: "识别产品模块", round: 0, totalRounds: 4, message: "正在分析产品模块划分..." });
  const modules = await invokeRoundWithRetry(
    model,
    "decomposer_r1",
    r1Prompt,
    `项目简报：\n\n${brief}\n\n请列出所有一级模块。输出格式：["模块A", "模块B"]`,
    parseModules,
    instructions,
    previousRowsContext,
  );
  onProgress?.({ stage: "识别产品模块", round: 1, totalRounds: 4, message: `已识别 ${modules.length} 个模块` });

  // ── Round 2: Sub-Modules ({module → [sub_modules]}) ──
  onProgress?.({ stage: "拆解子模块", round: 1, totalRounds: 4, message: "正在拆解子模块..." });
  const r2Pairs = await invokeRoundWithRetry(
    model,
    "decomposer_r2",
    r2Prompt,
    buildR2Prompt(modules, brief),
    (raw) => parseSubModules(raw, modules),
    instructions,
    previousRowsContext,
  );
  const subModules = r2Pairs;
  onProgress?.({ stage: "拆解子模块", round: 2, totalRounds: 4, message: `已拆解 ${r2Pairs.length} 个子模块` });

  // ── Round 3: Functions ({sub_module → [functions]}) ──
  onProgress?.({ stage: "识别功能点", round: 2, totalRounds: 4, message: "正在识别功能点..." });
  const r3Pairs = await invokeRoundWithRetry(
    model,
    "decomposer_r3",
    r3Prompt,
    buildR3Prompt(r2Pairs, brief),
    (raw) => parseFunctions(raw, r2Pairs),
    instructions,
    previousRowsContext,
  );
  onProgress?.({ stage: "识别功能点", round: 3, totalRounds: 4, message: `已识别 ${r3Pairs.length} 个功能点` });

  // ── Round 4: Leaves ({function → {sub_function: description}}) ──
  // Chunked by sub_module: each sub-module's functions are sent in a separate parallel LLM call.
  // This avoids token limit issues on large projects and enables parallel execution.
  onProgress?.({ stage: "生成子功能详情", round: 3, totalRounds: 4, message: "正在生成子功能详情..." });

  // Build sub_module → (module, functions) index
  const subToModule = new Map<string, string>();
  for (const [mod, sub] of r2Pairs) subToModule.set(sub, mod);

  const subsFuncs = new Map<string, { module: string; funcs: string[] }>();
  for (const [sub, func] of r3Pairs) {
    let entry = subsFuncs.get(sub);
    if (!entry) {
      entry = { module: subToModule.get(sub)!, funcs: [] };
      subsFuncs.set(sub, entry);
    }
    entry.funcs.push(func);
  }

  // Fire parallel R4 calls — one per sub-module
  const subResults = await Promise.all(
    [...subsFuncs.entries()].map(([subModule, { module, funcs }]) => {
      const filteredPrevRows = input.previousRows?.length
        ? formatPreviousRowsForSubModule(input.previousRows, subModule)
        : undefined;
      return invokeR4ForSubModule(
        model,
        "decomposer_r4",
        r4Prompt,
        module,
        subModule,
        funcs,
        brief,
        instructions,
        filteredPrevRows,
      );
    }),
  );

  // Flatten all sub-module results into single triple array
  const r4Triples: [string, string, string][] = subResults.flat();
  onProgress?.({ stage: "生成子功能详情", round: 4, totalRounds: 4, message: `已生成 ${r4Triples.length} 个子功能（${subsFuncs.size} 块并行）` });

  // ── Stitch: reconstruct QuotationRow[] from the forward-reference chain ──
  const rows = stitch(r2Pairs, r3Pairs, r4Triples);

  logger.info("decomposer complete (BFS)", {
    modules: modules.length,
    subModules: r2Pairs.length,
    functions: r3Pairs.length,
    rows: rows.length,
  });

  return { rows };
}
