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
    contextParts.push(
      `⚠️ 修改指令: ${instructions}\n` +
      "请只修改指令指定的部分，其他部分保持与参考结构一致。\n" +
      "如果修改指令引用的父级元素在当前输入中不存在（说明已被上一环节删除），跳过该指令。",
    );
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
  maxAttempts = 2,
): Promise<T> {
  let userPrompt = baseUserPrompt;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const raw = await invokeRoundWithContext(
        model, agentName, systemPrompt, userPrompt,
        attempt === 0 ? instructions : undefined,
        attempt === 0 ? previousRowsContext : undefined,
      );
      return parseFn(raw);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);

      if (attempt < maxAttempts - 1) {
        logger.warn(`${agentName} attempt ${attempt + 1} failed, retrying`, { error: errMsg });

        // Build round-specific retry hint to avoid confusing R4 with R3's index format
        let retryHint: string;
        if (agentName === "decomposer_r3") {
          retryHint = "修正要求：\n- JSON 的 key 必须使用输入中给出的索引数字字符串（\"0\", \"1\", ...）\n- key 必须是有效的整数索引，对应输入列表中 [0], [1], ... 的项目\n- 每个索引必须覆盖到，不要遗漏，不要自创索引";
        } else if (agentName === "decomposer_r4") {
          retryHint = "修正要求：\n- JSON 的 key 必须与功能列表中的名称逐字一致，不要加前缀、后缀或任何修饰\n- 不要自创名称，不要修改输入列表中的任何名称";
        } else if (agentName === "decomposer_r2") {
          retryHint = "修正要求：\n- JSON 的 key 必须与模块列表中的名称逐字一致，不要加前缀、后缀或任何修饰";
        } else {
          retryHint = "修正要求：\n- 请严格按照输入格式和输出格式要求重新输出";
        }

        userPrompt = `${baseUserPrompt}\n\n⚠️ 上一次输出校验失败：${errMsg}\n\n${retryHint}\n\n请修正后重新输出。`;
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

function parseFunctions(
  raw: unknown,
  parentPairs: [string, string][],
): [number, string][] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Decomposer R3: expected JSON object (not array)");
  }
  const obj = raw as Record<string, unknown>;
  const pairs: [number, string][] = [];

  for (const [idxStr, children] of Object.entries(obj)) {
    const idx = Number(idxStr);
    if (!Number.isInteger(idx) || idx < 0 || idx >= parentPairs.length) {
      throw new Error(
        `Decomposer R3: invalid index "${idxStr}" — must be integer 0-${parentPairs.length - 1}`,
      );
    }
    const [mod, sub] = parentPairs[idx];
    if (!Array.isArray(children)) {
      throw new Error(
        `Decomposer R3: value for index "${idxStr}" (${mod}→${sub}) is not an array`,
      );
    }
    for (const child of children) {
      if (typeof child !== "string" || !child.trim()) {
        throw new Error(
          `Decomposer R3: invalid function under index "${idxStr}" (${mod}→${sub})`,
        );
      }
      pairs.push([idx, child.trim()]);
    }
  }

  // Validate all indices are covered
  const covered = new Set(Object.keys(obj));
  const missing: number[] = [];
  for (let i = 0; i < parentPairs.length; i++) {
    if (!covered.has(String(i))) {
      missing.push(i);
    }
  }
  if (missing.length > 0) {
    const missingInfo = missing
      .map((i) => `[${i}] ${parentPairs[i][0]}→${parentPairs[i][1]}`)
      .join(", ");
    throw new Error(`Decomposer R3: missing functions for indices: ${missingInfo}`);
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
  r2Pairs: [string, string][],          // [module, sub_module]
  r3Pairs: [number, string][],          // [r2_index, function]
  r4Results: Map<number, [string, string, string][]>, // r2_index → R4 triples
): QuotationRow[] {
  // R3: group functions by r2 index
  const r3Map = new Map<number, string[]>();
  for (const [idx, func] of r3Pairs) {
    let arr = r3Map.get(idx);
    if (!arr) r3Map.set(idx, arr = []);
    arr.push(func);
  }

  const rows: QuotationRow[] = [];
  for (let i = 0; i < r2Pairs.length; i++) {
    const [module, sub] = r2Pairs[i];
    const funcs = r3Map.get(i) ?? [];
    // R4 lookups scoped to this sub-module's index — no cross-module collision
    const leaves = r4Results.get(i);
    const r4Map = new Map<string, [string, string][]>();
    if (leaves) {
      for (const [func, subFunc, desc] of leaves) {
        let arr = r4Map.get(func);
        if (!arr) r4Map.set(func, arr = []);
        arr.push([subFunc, desc]);
      }
    }

    for (const func of funcs) {
      for (const [subFunc, desc] of r4Map.get(func) ?? []) {
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
    "请为每个模块拆解子模块。",
    "",
    "示例 —— 假设输入模块列表：[\"门店老板版小程序\", \"运营后台\"]",
    "则输出：{\"门店老板版小程序\":[\"首页概览\",\"订单管理\",\"发货管理\"],\"运营后台\":[\"控制台\",\"价格管理\",\"账号与权限\"]}",
    "注意：key 必须与输入中的模块名逐字一致，不要加前缀或后缀。",
  ].join("\n");
}

function buildR3Prompt(r2Pairs: [string, string][], brief: string): string {
  // Build indexed list with full module → sub context
  const indexedList = r2Pairs
    .map(([mod, sub], i) => `  [${i}] ${mod} → ${sub}`)
    .join("\n");

  return [
    "模块-子模块关系（含索引）：",
    indexedList,
    "",
    "项目简报：",
    brief,
    "",
    "请为以上每个索引（[0], [1], ...）识别功能点，以索引数字字符串为 key 输出。",
    "",
    "示例 —— 假设输入：",
    "  [0] 门店老板版 → 订单管理",
    "  [1] 推广人员版 → 订单管理",
    "则输出：{\"0\":[\"新订单列表\",\"已成交订单\"],\"1\":[\"客户列表\",\"验机清单\"]}",
    "注意：[0] 对应 key \"0\"，[1] 对应 key \"1\"，一一映射。",
    "",
    "如果不同模块下有同名子模块，每个索引对应不同的子模块，请分别为每个索引输出功能点。",
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
    `请为子模块"${subModule}"下的 ${funcs.length} 个功能生成子功能和描述。`,
    "",
    "示例 —— 假设功能列表为 [\"新订单列表\", \"已成交订单\"]，",
    "则输出：{\"新订单列表\":{\"订单卡片展示\":\"列表页每行显示订单号、客户昵称、机型、预估报价、提交时间，支持左滑操作\",\"一键确认\":\"点击确认成交按钮后弹出确认弹窗\"},\"已成交订单\":{\"成交记录\":\"按成交时间倒序展示，支持按日期筛选\"}}",
    "注意：key 必须与功能列表中的名称逐字一致，不要加前缀或后缀。",
    "如果是基础功能（直接写描述）：{\"系统分层方案\":\"将系统划分为展示层、网关层...\"}",
    "",
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
function formatPreviousRowsForSubModule(rows: QuotationRow[], targetModule: string, targetSubModule: string): string {
  const filtered = rows.filter((r) => r.module === targetModule && r.sub_module === targetSubModule);
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
// Scoped previous-row formatters — one per hierarchy level
// In modification rounds, each round only sees the previous result at its own
// level, not the full 5-level tree. This prevents token waste and reduces
// distraction: R1 doesn't need to see sub-functions; R2 doesn't need functions.
// ===========================================================================

/**
 * R1 scoped: just the module list from the previous iteration.
 * Output is a flat Markdown list — the LLM only sees module names.
 */
function formatPreviousModules(rows: QuotationRow[]): string {
  if (!rows.length) return "";
  const modules = [...new Set(rows.map((r) => r.module))];
  const lines: string[] = [];
  lines.push(`## 参考：上一次拆解结果（模块层，共 ${modules.length} 个模块）`);
  lines.push("请在此结构基础上按修改指令调整，保持未涉及部分不变。");
  lines.push("");
  for (const m of modules) lines.push(`- ${m}`);
  return lines.join("\n");
}

/**
 * R2 scoped: module → sub_module mapping only.
 * No function or sub-function details — the LLM only sees the module+sub_module
 * structure from the previous run.
 */
function formatPreviousSubModules(rows: QuotationRow[]): string {
  if (!rows.length) return "";
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!map.has(r.module)) map.set(r.module, new Set());
    map.get(r.module)!.add(r.sub_module);
  }
  const totalSubs = [...map.values()].reduce((s, v) => s + v.size, 0);
  const lines: string[] = [];
  lines.push(`## 参考：上一次拆解结果（子模块层，${map.size} 个模块 → ${totalSubs} 个子模块）`);
  lines.push("请在此结构基础上按修改指令调整，保持未涉及部分不变。");
  lines.push("");
  for (const [mod, subs] of map) {
    lines.push(`### ${mod}`);
    for (const sub of subs) lines.push(`  - ${sub}`);
  }
  return lines.join("\n");
}

/**
 * R3 scoped: module → sub_module → function only.
 * The LLM sees functions but not sub-functions or descriptions from the
 * previous run — those belong to R4.
 */
function formatPreviousFunctions(rows: QuotationRow[]): string {
  if (!rows.length) return "";
  const map = new Map<string, Map<string, Set<string>>>();
  for (const r of rows) {
    if (!map.has(r.module)) map.set(r.module, new Map());
    const subMap = map.get(r.module)!;
    if (!subMap.has(r.sub_module)) subMap.set(r.sub_module, new Set());
    subMap.get(r.sub_module)!.add(r.function);
  }
  let totalFuncs = 0;
  for (const subMap of map.values()) {
    for (const funcs of subMap.values()) totalFuncs += funcs.size;
  }
  const lines: string[] = [];
  lines.push(`## 参考：上一次拆解结果（功能层，共 ${totalFuncs} 个功能）`);
  lines.push("请在此结构基础上按修改指令调整，保持未涉及部分不变。");
  lines.push("");
  for (const [mod, subMap] of map) {
    lines.push(`### ${mod}`);
    for (const [sub, funcs] of subMap) {
      lines.push(`  - ${sub}`);
      for (const func of funcs) lines.push(`    - ${func}`);
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
    3, // R4 content is longest, needs one extra retry
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
    /** Per-round instructions. Only rounds that need modification need a key. */
    roundInstructions?: {
      r1?: string;
      r2?: string;
      r3?: string;
      r4?: string;
    };
    previousRows?: QuotationRow[];
  },
  onProgress?: (progress: DecomposerProgress) => void,
): Promise<DecomposerOutput> {
  const brief = input.structuredBrief;
  if (!brief || !brief.trim()) {
    throw new Error("Decomposer: structuredBrief is empty");
  }

  const ri = input.roundInstructions;

  // Scoped previousRows context — each round only sees its own level
  const r1PrevContext = input.previousRows?.length
    ? formatPreviousModules(input.previousRows)
    : undefined;
  const r2PrevContext = input.previousRows?.length
    ? formatPreviousSubModules(input.previousRows)
    : undefined;
  const r3PrevContext = input.previousRows?.length
    ? formatPreviousFunctions(input.previousRows)
    : undefined;
  // R4 is already scoped per sub-module via formatPreviousRowsForSubModule

  logger.info("decomposer start (BFS)", {
    briefLen: brief.length,
    hasRoundInstructions: !!ri,
    hasPreviousRows: !!input.previousRows?.length,
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
    ri?.r1,
    r1PrevContext,
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
    ri?.r2,
    r2PrevContext,
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
    ri?.r3,
    r3PrevContext,
  );
  onProgress?.({ stage: "识别功能点", round: 3, totalRounds: 4, message: `已识别 ${r3Pairs.length} 个功能点` });

  // ── Round 4: Leaves ({function → {sub_function: description}}) ──
  // Chunked by sub_module: each sub-module's functions are sent in a separate parallel LLM call.
  // This avoids token limit issues on large projects and enables parallel execution.
  onProgress?.({ stage: "生成子功能详情", round: 3, totalRounds: 4, message: "正在生成子功能详情..." });

  // Group functions by r2 index for per-sub_module R4 calls
  const subsFuncs = new Map<number, { module: string; subModule: string; funcs: string[] }>();
  for (const [idx, func] of r3Pairs) {
    let entry = subsFuncs.get(idx);
    if (!entry) {
      const [mod, sub] = r2Pairs[idx];
      entry = { module: mod, subModule: sub, funcs: [] };
      subsFuncs.set(idx, entry);
    }
    entry.funcs.push(func);
  }

  // Fire parallel R4 calls — one per sub-module, preserving r2 index
  const r4Results = new Map<number, [string, string, string][]>();
  const r4Instructions = ri?.r4;
  const r4Promises = [...subsFuncs.entries()].map(async ([idx, { module, subModule, funcs }]) => {
    const filteredPrevRows = input.previousRows?.length
      ? formatPreviousRowsForSubModule(input.previousRows, module, subModule)
      : undefined;
    const triples = await invokeR4ForSubModule(
      model,
      "decomposer_r4",
      r4Prompt,
      module,
      subModule,
      funcs,
      brief,
      r4Instructions,
      filteredPrevRows,
    );
    r4Results.set(idx, triples);
  });
  await Promise.all(r4Promises);

  // Count total leaves
  const r4TriplesCount = [...r4Results.values()].reduce((sum, t) => sum + t.length, 0);
  onProgress?.({ stage: "生成子功能详情", round: 4, totalRounds: 4, message: `已生成 ${r4TriplesCount} 个子功能（${subsFuncs.size} 块并行）` });

  // ── Stitch: reconstruct QuotationRow[] from the forward-reference chain ──
  const rows = stitch(r2Pairs, r3Pairs, r4Results);

  logger.info("decomposer complete (BFS)", {
    modules: modules.length,
    subModules: r2Pairs.length,
    functions: r3Pairs.length,
    rows: rows.length,
  });

  return { rows };
}
