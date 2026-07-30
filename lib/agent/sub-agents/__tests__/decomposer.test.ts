/**
 * Decomposer unit tests — focuses on pure-function parsers/validators.
 *
 * Run: pnpm test:decomposer
 */
import assert from "node:assert";

// ===========================================================================
// Inlined functions under test (mirrors decomposer.ts)
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

// ===========================================================================
// Scoped previous-row formatters — one per hierarchy level
// ===========================================================================

interface QRow {
  seq: number;
  module: string;
  sub_module: string;
  function: string;
  sub_function: string;
  description: string;
  category: string;
  trades: Record<string, number | null>;
  remark: string;
}

function formatPreviousModules(rows: QRow[]): string {
  if (!rows.length) return "";
  const modules = [...new Set(rows.map((r) => r.module))];
  const lines: string[] = [];
  lines.push(`## 参考：上一次拆解结果（模块层，共 ${modules.length} 个模块）`);
  lines.push("请在此结构基础上按修改指令调整，保持未涉及部分不变。");
  lines.push("");
  for (const m of modules) lines.push(`- ${m}`);
  return lines.join("\n");
}

function formatPreviousSubModules(rows: QRow[]): string {
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

function formatPreviousFunctions(rows: QRow[]): string {
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
// Test runner
// ===========================================================================

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}

function assertThrows(fn: () => void, expectedMsg: string) {
  try {
    fn();
    throw new assert.AssertionError({ message: `Expected error "${expectedMsg}" but none thrown` });
  } catch (err) {
    if (err instanceof assert.AssertionError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes(expectedMsg)) {
      throw new assert.AssertionError({
        message: `Expected error containing "${expectedMsg}" but got: ${msg}`,
      });
    }
  }
}

// ===========================================================================
// parseModules tests (R1: flat string array)
// ===========================================================================

console.log("\nparseModules");

test("valid modules", () => {
  const result = parseModules(["系统设计", "用户端", "管理后台"]);
  assert.strictEqual(result.length, 3);
  assert.strictEqual(result[0], "系统设计");
  assert.strictEqual(result[1], "用户端");
  assert.strictEqual(result[2], "管理后台");
});

test("trims whitespace from module names", () => {
  const result = parseModules(["  系统设计  ", " 用户端 "]);
  assert.strictEqual(result[0], "系统设计");
  assert.strictEqual(result[1], "用户端");
});

test("rejects non-array input", () => {
  assertThrows(() => parseModules("not an array"), "expected JSON array");
  assertThrows(() => parseModules({ module: "系统设计" }), "expected JSON array");
});

test("rejects single module", () => {
  assertThrows(() => parseModules(["系统设计"]), "expected at least 2");
});

test("rejects empty module string", () => {
  assertThrows(() => parseModules(["系统设计", ""]), "must be non-empty string");
  assertThrows(() => parseModules(["系统设计", "  "]), "must be non-empty string");
});

test("rejects duplicate modules", () => {
  assertThrows(() => parseModules(["系统设计", "用户端", "系统设计"]), "duplicate modules");
});

test("rejects empty array", () => {
  assertThrows(() => parseModules([]), "expected at least 2");
});

// ===========================================================================
// parseSubModules tests (R2: {module → [sub_modules]})
// ===========================================================================

console.log("\nparseSubModules");

const mods = ["系统设计", "用户端"];

test("valid sub-modules for both parent modules", () => {
  const raw = { "系统设计": ["技术架构", "数据设计"], "用户端": ["首页", "个人中心"] };
  const result = parseSubModules(raw, mods);
  assert.strictEqual(result.length, 4);
  assert.deepStrictEqual(result[0], ["系统设计", "技术架构"]);
  assert.deepStrictEqual(result[1], ["系统设计", "数据设计"]);
  assert.deepStrictEqual(result[2], ["用户端", "首页"]);
  assert.deepStrictEqual(result[3], ["用户端", "个人中心"]);
});

test("rejects non-object input", () => {
  assertThrows(() => parseSubModules(["not object"], mods), "expected JSON object");
});

test("rejects unknown module", () => {
  assertThrows(
    () => parseSubModules({ "系统设计": ["技术架构"], "未知模块": ["子模块"] }, mods),
    "unknown module",
  );
});

test("rejects non-array children", () => {
  assertThrows(
    () => parseSubModules({ "系统设计": "not array", "用户端": ["首页"] }, mods),
    "not an array",
  );
});

test("rejects missing sub-module for a parent module", () => {
  assertThrows(
    () => parseSubModules({ "系统设计": ["技术架构"] }, mods),
    "missing sub-modules for: 用户端",
  );
});

test("rejects empty sub_module string", () => {
  assertThrows(
    () => parseSubModules({ "系统设计": ["技术架构"], "用户端": [""] }, mods),
    "invalid sub_module",
  );
});

// ===========================================================================
// parseFunctions tests (R3: {sub_module → [functions]})
// ===========================================================================

console.log("\nparseFunctions");

const r2Pairs: [string, string][] = [
  ["系统设计", "技术架构"],
  ["用户端", "首页"],
];

test("valid functions for both sub-modules", () => {
  const raw = { "0": ["技术选型", "部署方案"], "1": ["Banner展示"] };
  const result = parseFunctions(raw, r2Pairs);
  assert.strictEqual(result.length, 3);
  assert.deepStrictEqual(result[0], [0, "技术选型"]);
  assert.deepStrictEqual(result[1], [0, "部署方案"]);
  assert.deepStrictEqual(result[2], [1, "Banner展示"]);
});

test("rejects non-object input", () => {
  assertThrows(() => parseFunctions([], r2Pairs), "expected JSON object");
});

test("rejects unknown sub_module (invalid index)", () => {
  assertThrows(
    () => parseFunctions({ "0": ["技术选型"], "5": ["功能"] }, r2Pairs),
    "invalid index",
  );
});

test("rejects missing function for a sub-module", () => {
  assertThrows(
    () => parseFunctions({ "0": ["技术选型"] }, r2Pairs),
    "missing functions for indices: [1]",
  );
});

test("rejects non-array children", () => {
  assertThrows(
    () => parseFunctions({ "0": "not array", "1": ["Banner"] }, r2Pairs),
    "not an array",
  );
});

test("rejects empty function string", () => {
  assertThrows(
    () => parseFunctions({ "0": [""], "1": ["Banner"] }, r2Pairs),
    "invalid function",
  );
});

test("handles duplicate sub-module names from different parent modules", () => {
  const r2PairsWithDuplicates: [string, string][] = [
    ["门店老板版", "订单管理"],
    ["推广人员版", "订单管理"],
    ["门店老板版", "数据分析"],
  ];
  const raw = {
    "0": ["新订单列表", "已成交订单"],
    "1": ["客户列表", "验机清单"],
    "2": ["用户增长", "利润分析"],
  };
  const result = parseFunctions(raw, r2PairsWithDuplicates);
  assert.strictEqual(result.length, 6);
  assert.deepStrictEqual(result[0], [0, "新订单列表"]);
  assert.deepStrictEqual(result[1], [0, "已成交订单"]);
  assert.deepStrictEqual(result[2], [1, "客户列表"]);
  assert.deepStrictEqual(result[3], [1, "验机清单"]);
  assert.deepStrictEqual(result[4], [2, "用户增长"]);
  assert.deepStrictEqual(result[5], [2, "利润分析"]);
});

// ===========================================================================
// parseLeaves tests (R4: {function → {sub_function: description}})
// ===========================================================================

console.log("\nparseLeaves");

const r3Pairs: [string, string][] = [
  ["技术架构", "技术选型"],
  ["首页", "Banner展示"],
];

test("valid leaves", () => {
  const raw = {
    "技术选型": {
      "前端框架选型": "确定React/Vue等前端框架，评估生态系统和团队能力",
      "后端框架选型": "确定Node/Java等后端框架，设计API规范",
    },
    "Banner展示": {
      "轮播Banner": "首页顶部轮播广告位，支持图片和视频格式",
    },
  };
  const result = parseLeaves(raw, r3Pairs);
  assert.strictEqual(result.length, 3);
  assert.deepStrictEqual(result[0], ["技术选型", "前端框架选型", "确定React/Vue等前端框架，评估生态系统和团队能力"]);
  assert.deepStrictEqual(result[1], ["技术选型", "后端框架选型", "确定Node/Java等后端框架，设计API规范"]);
  assert.deepStrictEqual(result[2], ["Banner展示", "轮播Banner", "首页顶部轮播广告位，支持图片和视频格式"]);
});

test("rejects non-object input", () => {
  assertThrows(() => parseLeaves([], r3Pairs), "expected JSON object");
});

test("rejects unknown function", () => {
  const raw = { "技术选型": { "前端": "desc" }, "未知功能": { "子功能": "desc" } };
  assertThrows(() => parseLeaves(raw, r3Pairs), "unknown function");
});

test("rejects non-object children", () => {
  const raw = { "技术选型": "not object", "Banner展示": { "轮播": "desc" } };
  assertThrows(() => parseLeaves(raw, r3Pairs), "not an object");
});

test("rejects sub_function identical to function", () => {
  const raw = { "技术选型": { "技术选型": "desc" }, "Banner展示": { "轮播": "desc" } };
  assertThrows(() => parseLeaves(raw, r3Pairs), "must differ");
});

test("rejects empty description", () => {
  const raw = { "技术选型": { "前端": "" }, "Banner展示": { "轮播": "desc" } };
  assertThrows(() => parseLeaves(raw, r3Pairs), "empty description");
});

test("rejects missing leaf for a function", () => {
  const raw = { "技术选型": { "前端": "desc" } };
  assertThrows(() => parseLeaves(raw, r3Pairs), "missing leaves for: Banner展示");
});

test("rejects empty result (no leaves)", () => {
  const raw: Record<string, unknown> = {};
  assertThrows(() => parseLeaves(raw, r3Pairs), "no valid leaf triples");
});

// ===========================================================================
// Scoped formatters tests — verify each level truncates at the right depth
// ===========================================================================

console.log("\nScoped formatters");

function makeRow(mod: string, sub: string, func: string, subFunc: string): QRow {
  return { seq: 0, module: mod, sub_module: sub, function: func, sub_function: subFunc, description: "desc", category: "feature", trades: {}, remark: "" };
}

const sampleRows: QRow[] = [
  makeRow("系统设计", "技术架构", "技术选型", "前端框架选型"),
  makeRow("系统设计", "技术架构", "技术选型", "后端框架选型"),
  makeRow("系统设计", "技术架构", "部署方案", "云基础设施"),
  makeRow("系统设计", "数据设计", "数据模型", "核心实体设计"),
  makeRow("用户端", "首页", "Banner展示", "轮播广告"),
  makeRow("用户端", "首页", "Banner展示", "快捷入口"),
  makeRow("用户端", "个人中心", "个人信息", "资料编辑"),
];

test("formatPreviousModules — only module names, no sub/func/leaf details", () => {
  const output = formatPreviousModules(sampleRows);
  assert.ok(output.includes("系统设计"));
  assert.ok(output.includes("用户端"));
  // Must NOT contain sub-module, function, or sub-function names
  assert.ok(!output.includes("技术架构"));
  assert.ok(!output.includes("技术选型"));
  assert.ok(!output.includes("前端框架选型"));
  assert.ok(!output.includes("Banner展示"));
  assert.ok(!output.includes("轮播广告"));
});

test("formatPreviousModules — deduplicates modules", () => {
  const dupRows = [
    makeRow("系统设计", "a", "b", "c"),
    makeRow("系统设计", "d", "e", "f"),
    makeRow("用户端", "g", "h", "i"),
  ];
  const output = formatPreviousModules(dupRows);
  // "系统设计" should appear exactly once
  const matches = output.match(/系统设计/g);
  assert.strictEqual(matches?.length, 1);
});

test("formatPreviousModules — empty rows returns empty string", () => {
  assert.strictEqual(formatPreviousModules([]), "");
});

test("formatPreviousSubModules — module→sub_module only, no func/leaf", () => {
  const output = formatPreviousSubModules(sampleRows);
  assert.ok(output.includes("系统设计"));
  assert.ok(output.includes("技术架构"));
  assert.ok(output.includes("数据设计"));
  assert.ok(output.includes("用户端"));
  assert.ok(output.includes("首页"));
  assert.ok(output.includes("个人中心"));
  // Must NOT contain function or sub-function names
  assert.ok(!output.includes("技术选型"));
  assert.ok(!output.includes("部署方案"));
  assert.ok(!output.includes("Banner展示"));
  assert.ok(!output.includes("前端框架选型"));
  assert.ok(!output.includes("轮播广告"));
  assert.ok(!output.includes("资料编辑"));
});

test("formatPreviousSubModules — deduplicates sub-modules", () => {
  const dupRows = [
    makeRow("系统设计", "技术架构", "技术选型", "前端"),
    makeRow("系统设计", "技术架构", "技术选型", "后端"),
    makeRow("系统设计", "技术架构", "部署方案", "云"),
  ];
  const output = formatPreviousSubModules(dupRows);
  // "技术架构" should appear exactly once under 系统设计
  const lines = output.split("\n");
  const techArchLines = lines.filter((l: string) => l.includes("技术架构"));
  assert.strictEqual(techArchLines.length, 1);
});

test("formatPreviousSubModules — empty rows returns empty string", () => {
  assert.strictEqual(formatPreviousSubModules([]), "");
});

test("formatPreviousFunctions — module→sub_module→function, no leaf", () => {
  const output = formatPreviousFunctions(sampleRows);
  assert.ok(output.includes("系统设计"));
  assert.ok(output.includes("技术架构"));
  assert.ok(output.includes("技术选型"));
  assert.ok(output.includes("部署方案"));
  assert.ok(output.includes("数据设计"));
  assert.ok(output.includes("数据模型"));
  assert.ok(output.includes("用户端"));
  assert.ok(output.includes("Banner展示"));
  assert.ok(output.includes("个人信息"));
  // Must NOT contain sub-function names or descriptions
  assert.ok(!output.includes("前端框架选型"));
  assert.ok(!output.includes("后端框架选型"));
  assert.ok(!output.includes("云基础设施"));
  assert.ok(!output.includes("轮播广告"));
  assert.ok(!output.includes("资料编辑"));
});

test("formatPreviousFunctions — deduplicates functions within a sub-module", () => {
  const dupRows = [
    makeRow("系统设计", "技术架构", "技术选型", "前端"),
    makeRow("系统设计", "技术架构", "技术选型", "后端"),
  ];
  const output = formatPreviousFunctions(dupRows);
  // "技术选型" should appear (only in the function entry line, not in stats header)
  const count = (output.match(/技术选型/g) || []).length;
  assert.strictEqual(count, 1);
});

test("formatPreviousFunctions — empty rows returns empty string", () => {
  assert.strictEqual(formatPreviousFunctions([]), "");
});

test("formatPreviousFunctions — correct indent levels (module h3, sub 2-space, func 4-space)", () => {
  const rows = [makeRow("系统设计", "技术架构", "技术选型", "前端")];
  const output = formatPreviousFunctions(rows);
  assert.ok(output.includes("### 系统设计"));
  assert.ok(output.includes("  - 技术架构"));
  assert.ok(output.includes("    - 技术选型"));
});

// ===========================================================================
// Full pipeline simulation (no LLM) — R1 → R2 → R3 → R4
// ===========================================================================

console.log("\nFull pipeline (no LLM)");

test("R1→R2→R3→R4 all parsers chain correctly", () => {
  // R1
  const r1 = parseModules(["系统设计", "用户端"]);
  assert.strictEqual(r1.length, 2);

  // R2
  const r2 = parseSubModules(
    { "系统设计": ["技术架构"], "用户端": ["首页"] },
    r1,
  );
  assert.strictEqual(r2.length, 2);

  // R3 — returns [r2_index, function] pairs
  const r3 = parseFunctions(
    { "0": ["技术选型"], "1": ["Banner展示"] },
    r2,
  );
  assert.strictEqual(r3.length, 2);
  assert.deepStrictEqual(r3[0], [0, "技术选型"]);
  assert.deepStrictEqual(r3[1], [1, "Banner展示"]);

  // R3 pairs for R4: look up sub_module from r2 by index
  const r3PairsForR4: [string, string][] = r3.map(([i, func]) => [r2[i][1], func]);

  // R4
  const r4 = parseLeaves(
    {
      "技术选型": { "前端框架选型": "确定前端框架" },
      "Banner展示": { "轮播广告": "首页顶部轮播广告位" },
    },
    r3PairsForR4,
  );
  assert.strictEqual(r4.length, 2);
  assert.deepStrictEqual(r4[0], ["技术选型", "前端框架选型", "确定前端框架"]);
  assert.deepStrictEqual(r4[1], ["Banner展示", "轮播广告", "首页顶部轮播广告位"]);
});

// ===========================================================================
// Summary
// ===========================================================================

console.log(`\n${"─".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);

if (failed > 0) {
  process.exit(1);
}
