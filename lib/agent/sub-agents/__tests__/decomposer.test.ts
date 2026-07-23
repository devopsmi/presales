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
  const raw = { "技术架构": ["技术选型", "部署方案"], "首页": ["Banner展示"] };
  const result = parseFunctions(raw, r2Pairs);
  assert.strictEqual(result.length, 3);
  assert.deepStrictEqual(result[0], ["技术架构", "技术选型"]);
  assert.deepStrictEqual(result[1], ["技术架构", "部署方案"]);
  assert.deepStrictEqual(result[2], ["首页", "Banner展示"]);
});

test("rejects non-object input", () => {
  assertThrows(() => parseFunctions([], r2Pairs), "expected JSON object");
});

test("rejects unknown sub_module", () => {
  assertThrows(
    () => parseFunctions({ "技术架构": ["技术选型"], "未知子模块": ["功能"] }, r2Pairs),
    "unknown sub_module",
  );
});

test("rejects missing function for a sub-module", () => {
  assertThrows(
    () => parseFunctions({ "技术架构": ["技术选型"] }, r2Pairs),
    "missing functions for: 首页",
  );
});

test("rejects non-array children", () => {
  assertThrows(
    () => parseFunctions({ "技术架构": "not array", "首页": ["Banner"] }, r2Pairs),
    "not an array",
  );
});

test("rejects empty function string", () => {
  assertThrows(
    () => parseFunctions({ "技术架构": [""], "首页": ["Banner"] }, r2Pairs),
    "invalid function",
  );
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

  // R3
  const r3 = parseFunctions(
    { "技术架构": ["技术选型"], "首页": ["Banner展示"] },
    r2,
  );
  assert.strictEqual(r3.length, 2);

  // R4
  const r4 = parseLeaves(
    {
      "技术选型": { "前端框架选型": "确定前端框架" },
      "Banner展示": { "轮播广告": "首页顶部轮播广告位" },
    },
    r3,
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
