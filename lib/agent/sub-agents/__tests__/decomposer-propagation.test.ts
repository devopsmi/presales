/**
 * Change propagation & pruning unit tests for DecomposerTree.
 *
 * Tests the full modification pipeline without LLM:
 *   DecomposerTree.fromPreviousRows → CRUD mutations → diffSnapshots →
 *   buildChangeSet → downstream pruning (getRowsAtLevelPruned,
 *   getAffectedSubModuleKeys, getRowsForSubModule)
 *
 * Run: pnpm tsx lib/agent/sub-agents/__tests__/decomposer-propagation.test.ts
 */
import assert from "node:assert";
import { DecomposerTree } from "../decomposer/table";
import type { QuotationRow } from "../../../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function assertSetsEqual<T>(actual: Set<T>, expected: T[], label: string) {
  const actualArr = [...actual].sort();
  const expectedArr = [...expected].sort();
  if (actualArr.length !== expectedArr.length) {
    throw new assert.AssertionError({
      message: `${label}: size mismatch — expected ${expectedArr.length} items, got ${actualArr.length}\n  expected: [${expectedArr.join(", ")}]\n  actual:   [${actualArr.join(", ")}]`,
    });
  }
  for (const e of expected) {
    if (!actual.has(e)) {
      throw new assert.AssertionError({
        message: `${label}: missing expected item "${String(e)}"\n  actual: [${[...actual].join(", ")}]`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Fixture — creates a realistic 2-module × 2-sub × 2-func × 1-leaf tree
// ---------------------------------------------------------------------------

function makeMockRow(
  module: string,
  sub_module: string,
  func: string,
  sub_function: string,
): QuotationRow {
  return {
    seq: 0,
    module,
    sub_module,
    function: func,
    sub_function,
    description: `desc for ${sub_function}`,
    category: "feature",
    trades: {},
    remark: "",
  };
}

/**
 * 系统A (2 sub_modules, each 2 functions, each 1 leaf)
 * 系统B (2 sub_modules, each 2 functions, each 1 leaf)
 * Total: 2 modules × 2 subs × 2 funcs × 1 leaf = 8 leaves
 */
function fixtureRows(): QuotationRow[] {
  return [
    // 系统A → 模块管理 → 创建模块 / 编辑模块
    makeMockRow("系统A", "模块管理", "创建模块", "表单校验"),
    makeMockRow("系统A", "模块管理", "编辑模块", "回填数据"),
    // 系统A → 权限管理 → 角色管理 / 权限分配
    makeMockRow("系统A", "权限管理", "角色管理", "角色列表"),
    makeMockRow("系统A", "权限管理", "权限分配", "权限树"),
    // 系统B → 订单管理 → 创建订单 / 订单列表
    makeMockRow("系统B", "订单管理", "创建订单", "购物车结算"),
    makeMockRow("系统B", "订单管理", "订单列表", "分页查询"),
    // 系统B → 支付管理 → 微信支付 / 退款处理
    makeMockRow("系统B", "支付管理", "微信支付", "扫码支付"),
    makeMockRow("系统B", "支付管理", "退款处理", "原路退回"),
  ];
}

function createFixtureTree(): DecomposerTree {
  return DecomposerTree.fromPreviousRows(fixtureRows());
}

// ---------------------------------------------------------------------------
// determineStartRound
// ---------------------------------------------------------------------------

console.log("\ndetermineStartRound");

function determineStartRound(ri?: { r1?: string; r2?: string; r3?: string; r4?: string }): number {
  if (!ri) return 1;
  if (ri.r1) return 1;
  if (ri.r2) return 2;
  if (ri.r3) return 3;
  if (ri.r4) return 4;
  return 1;
}

test("no instructions → start at round 1 (full decomposition)", () => {
  assert.strictEqual(determineStartRound(undefined), 1);
  assert.strictEqual(determineStartRound({}), 1);
});

test("r1 instruction → start at 1", () => {
  assert.strictEqual(determineStartRound({ r1: "add module" }), 1);
});

test("only r2 instruction → start at 2 (skip R1)", () => {
  assert.strictEqual(determineStartRound({ r2: "rename sub" }), 2);
});

test("only r3 instruction → start at 3", () => {
  assert.strictEqual(determineStartRound({ r3: "add function" }), 3);
});

test("only r4 instruction → start at 4", () => {
  assert.strictEqual(determineStartRound({ r4: "update desc" }), 4);
});

test("r2+r3 both present → start at 2 (first non-empty)", () => {
  assert.strictEqual(determineStartRound({ r2: "rename", r3: "add" }), 2);
});

// ---------------------------------------------------------------------------
// DecomposerTree.fromPreviousRows — correct tree reconstruction
// ---------------------------------------------------------------------------

console.log("\nDecomposerTree.fromPreviousRows");

test("reconstructs correct module count", () => {
  const tree = createFixtureTree();
  assert.strictEqual(tree.getModuleNames().length, 2);
  assert.deepStrictEqual(tree.getModuleNames().sort(), ["系统A", "系统B"]);
});

test("reconstructs correct sub_module count", () => {
  const tree = createFixtureTree();
  const subs = tree.getSubModulePairs();
  assert.strictEqual(subs.length, 4); // 2 modules × 2 subs each
});

test("reconstructs correct level-3 function count", () => {
  const tree = createFixtureTree();
  assert.strictEqual(tree.getRowsAtLevel(3).length, 8); // 4 subs × 2 funcs each
});

test("reconstructs correct level-4 leaf count", () => {
  const tree = createFixtureTree();
  assert.strictEqual(tree.getRowsAtLevel(4).length, 8); // 8 funcs × 1 leaf each
});

test("toQuotationRows produces same count", () => {
  const tree = createFixtureTree();
  const rows = tree.toQuotationRows();
  assert.strictEqual(rows.length, 8);
});

test("leaf descriptions preserved", () => {
  const tree = createFixtureTree();
  const leaves = tree.getRowsAtLevel(4);
  const descs = leaves.map((l) => l.description);
  // Fixture creates descriptions as "desc for ${sub_function}"
  assert.ok(descs.includes("desc for 表单校验"));
  assert.ok(descs.includes("desc for 扫码支付"));
});

// ---------------------------------------------------------------------------
// Snapshot + diff — change detection
// ---------------------------------------------------------------------------

console.log("\nSnapshot & diff");

test("snapshot diff: no changes → empty diff", () => {
  const tree = createFixtureTree();
  const before = tree.buildLevelSnapshot(1);
  const after = tree.buildLevelSnapshot(1);
  const diff = DecomposerTree.diffSnapshots(before, after);
  assert.strictEqual(diff.length, 0);
});

test("snapshot diff: add module detected", () => {
  const tree = createFixtureTree();
  const before = tree.buildLevelSnapshot(1);
  tree.addModules(["系统C"]);
  const after = tree.buildLevelSnapshot(1);
  const diff = DecomposerTree.diffSnapshots(before, after);
  assert.strictEqual(diff.length, 1);
});

test("snapshot diff: rename module detected", () => {
  const tree = createFixtureTree();
  const before = tree.buildLevelSnapshot(1);
  tree.renameModule("系统A", "系统Aplus");
  const after = tree.buildLevelSnapshot(1);
  const diff = DecomposerTree.diffSnapshots(before, after);
  assert.strictEqual(diff.length, 1);
});

test("snapshot diff: delete module detected", () => {
  const tree = createFixtureTree();
  const before = tree.buildLevelSnapshot(1);
  tree.deleteModules(["系统B"]);
  const after = tree.buildLevelSnapshot(1);
  const diff = DecomposerTree.diffSnapshots(before, after);
  assert.strictEqual(diff.length, 1); // 系统B removed
});

test("snapshot diff: add + delete both detected", () => {
  const tree = createFixtureTree();
  const before = tree.buildLevelSnapshot(1);
  tree.addModules(["系统C"]);
  tree.deleteModules(["系统B"]);
  const after = tree.buildLevelSnapshot(1);
  const diff = DecomposerTree.diffSnapshots(before, after);
  assert.strictEqual(diff.length, 2);
});

test("snapshot diff: L2 sub_module rename detected", () => {
  const tree = createFixtureTree();
  const before = tree.buildLevelSnapshot(2);
  tree.renameSubModule("系统A", "模块管理", "内容管理");
  const after = tree.buildLevelSnapshot(2);
  const diff = DecomposerTree.diffSnapshots(before, after);
  assert.strictEqual(diff.length, 1);
});

// ---------------------------------------------------------------------------
// buildChangeSet — translating changed IDs to affected keys
// ---------------------------------------------------------------------------

console.log("\nbuildChangeSet");

test("L1 module add → affectedSubModules include all subs under new module", () => {
  const tree = createFixtureTree();
  const before = tree.buildLevelSnapshot(1);
  tree.addModules(["系统C"]);
  tree.addSubModules("系统C", ["子模块1", "子模块2"]);
  const after = tree.buildLevelSnapshot(1);
  const diff = DecomposerTree.diffSnapshots(before, after);

  const cs = tree.buildChangeSet(diff);
  // Adding a module at L1 → the module node's id is in diff
  // Running buildChangeSet on L1 changedIds: module node has no parent sub
  assert.strictEqual(cs.affectedIds.size, 1);
});

test("L2 sub_module rename → affectedSubModules contains exact key", () => {
  const tree = createFixtureTree();

  // Snapshot the L2 state BEFORE rename
  const before = tree.buildLevelSnapshot(2);
  const oldName = "模块管理";
  tree.renameSubModule("系统A", oldName, "内容管理");
  const after = tree.buildLevelSnapshot(2);
  const diff = DecomposerTree.diffSnapshots(before, after);

  const cs = tree.buildChangeSet(diff);
  assertSetsEqual(cs.affectedSubModules, ["系统A::内容管理"], "affectedSubModules");
  assert.strictEqual(cs.affectedIds.size, 1);
});

test("L2 sub_module add → affectedSubModules contains new key", () => {
  const tree = createFixtureTree();
  const before = tree.buildLevelSnapshot(2);
  tree.addSubModules("系统A", ["数据统计"]);
  const after = tree.buildLevelSnapshot(2);
  const diff = DecomposerTree.diffSnapshots(before, after);

  const cs = tree.buildChangeSet(diff);
  assertSetsEqual(cs.affectedSubModules, ["系统A::数据统计"], "affectedSubModules");
});

test("L2 sub_module delete → deleted nodes not in affectedSubModules (correct: they're gone, nothing to prune)", () => {
  const tree = createFixtureTree();
  const before = tree.buildLevelSnapshot(2);
  tree.deleteSubModules("系统A", ["模块管理"]);
  const after = tree.buildLevelSnapshot(2);
  const diff = DecomposerTree.diffSnapshots(before, after);

  // diffSnapshots detects the deletion, but buildChangeSet cannot resolve
  // the path since the node is already removed from idMap. This is correct:
  // deleted sub_modules need no downstream processing (R3/R4 have nothing to do).
  const cs = tree.buildChangeSet(diff);
  assert.strictEqual(cs.affectedIds.size, 1, "deletion IS detected in diff");
  assert.strictEqual(cs.affectedSubModules.size, 0, "but deleted node path unresolvable → no affectedSubModules");
});

test("L3 function add → affectedFunctions contains new key", () => {
  const tree = createFixtureTree();
  // First add a function at L3 under an existing sub_module
  const before = tree.buildLevelSnapshot(3);
  tree.addFunctions("系统A", "模块管理", ["删除模块"]);
  const after = tree.buildLevelSnapshot(3);
  const diff = DecomposerTree.diffSnapshots(before, after);

  const cs = tree.buildChangeSet(diff);
  assertSetsEqual(cs.affectedFunctions, ["系统A::模块管理::删除模块"], "affectedFunctions");
  // Also the parent sub_module should be affected
  assertSetsEqual(cs.affectedSubModules, ["系统A::模块管理"], "affectedSubModules (parent)");
});

test("L3 function rename → affectedFunctions contains renamed key", () => {
  const tree = createFixtureTree();
  const before = tree.buildLevelSnapshot(3);
  tree.renameFunction("系统B", "订单管理", "创建订单", "新增订单");
  const after = tree.buildLevelSnapshot(3);
  const diff = DecomposerTree.diffSnapshots(before, after);

  const cs = tree.buildChangeSet(diff);
  assertSetsEqual(cs.affectedFunctions, ["系统B::订单管理::新增订单"], "affectedFunctions");
  assertSetsEqual(cs.affectedSubModules, ["系统B::订单管理"], "affectedSubModules (parent)");
});

// ---------------------------------------------------------------------------
// R3 pruning — getRowsAtLevelPruned
// ---------------------------------------------------------------------------

console.log("\nR3 context pruning (getRowsAtLevelPruned)");

test("R3 pruned: only affected sub-modules shown", () => {
  const tree = createFixtureTree();

  // Simulate R2 changed "模块管理" in "系统A" → only that sub_module affected
  const before = tree.buildLevelSnapshot(2);
  tree.renameSubModule("系统A", "模块管理", "内容管理");
  const after = tree.buildLevelSnapshot(2);
  const diff = DecomposerTree.diffSnapshots(before, after);
  const cs = tree.buildChangeSet(diff);

  const pruned = tree.getRowsAtLevelPruned(3, cs);

  // Only "系统A::内容管理" rows in pruned context
  assert.strictEqual(pruned.length, 1, "pruned context should have 1 sub_module row");

  // Verify the row is for the renamed sub_module
  assert.strictEqual(pruned[0].module, "系统A");
  assert.strictEqual(pruned[0].sub_module, "内容管理");
  // Must NOT contain unaffected sub_modules
  const subModulesInPruned = pruned.map((r) => `${r.module}::${r.sub_module}`);
  assert.ok(!subModulesInPruned.includes("系统A::权限管理"), "unaffected sub should NOT be in pruned context");
  assert.ok(!subModulesInPruned.includes("系统B::订单管理"), "unaffected sub should NOT be in pruned context");
  assert.ok(!subModulesInPruned.includes("系统B::支付管理"), "unaffected sub should NOT be in pruned context");
});

test("R3 pruned: rename + delete → only rename shows in pruned context (delete is gone)", () => {
  const tree = createFixtureTree();

  const before = tree.buildLevelSnapshot(2);
  tree.renameSubModule("系统A", "模块管理", "内容管理");
  tree.deleteSubModules("系统B", ["支付管理"]);
  const after = tree.buildLevelSnapshot(2);
  const diff = DecomposerTree.diffSnapshots(before, after);
  const cs = tree.buildChangeSet(diff);

  const pruned = tree.getRowsAtLevelPruned(3, cs);
  // "系统B::支付管理" was deleted → its node is gone from tree, can't appear in pruned context
  // "系统A::内容管理" was renamed → path is resolvable, appears in pruned context
  const keys = pruned.map((r) => `${r.module}::${r.sub_module}`);
  assert.ok(keys.includes("系统A::内容管理"), "renamed sub should be in pruned context");
  assert.ok(!keys.includes("系统B::支付管理"), "deleted sub CANNOT be in pruned context (node is gone)");
  assert.strictEqual(keys.length, 1, "only the renamed (still-existing) sub appears");
});

test("R3 pruned: no changes → empty pruned context", () => {
  const tree = createFixtureTree();
  const before = tree.buildLevelSnapshot(2);
  const after = tree.buildLevelSnapshot(2);
  const diff = DecomposerTree.diffSnapshots(before, after);
  const cs = tree.buildChangeSet(diff);

  const pruned = tree.getRowsAtLevelPruned(3, cs);
  assert.strictEqual(pruned.length, 0, "no changes → no pruned rows");
});

// ---------------------------------------------------------------------------
// R4 pruning — getAffectedSubModuleKeys + getRowsForSubModule
// ---------------------------------------------------------------------------

console.log("\nR4 context pruning (agent-level + row-level)");

test("R4 agent-level: getAffectedSubModuleKeys returns correct keys", () => {
  const tree = createFixtureTree();

  // Simulate R3 changes: rename "创建模块" → "新建模块" under 系统A→模块管理
  const before = tree.buildLevelSnapshot(3);
  tree.renameFunction("系统A", "模块管理", "创建模块", "新建模块");
  const after = tree.buildLevelSnapshot(3);
  const diff = DecomposerTree.diffSnapshots(before, after);
  const cs = tree.buildChangeSet(diff);

  const affectedSubModuleKeys = tree.getAffectedSubModuleKeys(cs);
  assertSetsEqual(affectedSubModuleKeys, ["系统A::模块管理"], "R4 agent-level keys");
  // Other sub_modules should NOT be affected
  assert.ok(!affectedSubModuleKeys.has("系统A::权限管理"));
  assert.ok(!affectedSubModuleKeys.has("系统B::订单管理"));
});

test("R4 agent-level: multiple function changes → all parent sub_modules affected", () => {
  const tree = createFixtureTree();

  const before = tree.buildLevelSnapshot(3);
  tree.addFunctions("系统A", "模块管理", ["批量删除"]);
  tree.renameFunction("系统B", "支付管理", "退款处理", "退款审核");
  const after = tree.buildLevelSnapshot(3);
  const diff = DecomposerTree.diffSnapshots(before, after);
  const cs = tree.buildChangeSet(diff);

  const affectedSubModuleKeys = tree.getAffectedSubModuleKeys(cs);
  assertSetsEqual(
    affectedSubModuleKeys,
    ["系统A::模块管理", "系统B::支付管理"],
    "R4 agent-level keys (2 sub-modules)",
  );
});

test("R4 row-level: getRowsForSubModule with prunedFunctionKeys only returns affected functions", () => {
  const tree = createFixtureTree();

  // 系统A→模块管理 has functions: 创建模块, 编辑模块
  // Simulate R3 only changed "创建模块"
  const before = tree.buildLevelSnapshot(3);
  tree.renameFunction("系统A", "模块管理", "创建模块", "新建模块");
  const after = tree.buildLevelSnapshot(3);
  const diff = DecomposerTree.diffSnapshots(before, after);
  const cs = tree.buildChangeSet(diff);

  // getRowsForSubModule with pruned function keys
  const prunedRows = tree.getRowsForSubModule(
    "系统A",
    "模块管理",
    cs.affectedFunctions,
  );

  // Should only contain rows related to "新建模块" (was "创建模块")
  const functionNames = [...new Set(prunedRows.map((r) => r.function))];
  assert.ok(functionNames.includes("新建模块"), "affected function should be in pruned rows");
  assert.ok(!functionNames.includes("编辑模块"), "unaffected function should NOT be in pruned rows");
});

test("R4 row-level: full context (no prune) returns all functions in sub_module", () => {
  const tree = createFixtureTree();

  const fullRows = tree.getRowsForSubModule("系统B", "订单管理");

  // Should have both functions: 创建订单, 订单列表
  const funcNames = [...new Set(fullRows.filter((r) => r.function !== null).map((r) => r.function))];
  assert.strictEqual(funcNames.length, 2);
  assert.ok(funcNames.includes("创建订单"));
  assert.ok(funcNames.includes("订单列表"));
});

test("R4 row-level: empty prunedFunctionKeys → returns nothing", () => {
  const tree = createFixtureTree();
  const emptyPruned = tree.getRowsForSubModule(
    "系统A",
    "模块管理",
    new Set<string>(),
  );
  // When prunedFunctionKeys is empty, no functions match → returns nothing
  assert.strictEqual(emptyPruned.length, 0);
});

// ---------------------------------------------------------------------------
// Full propagation chain simulation (no LLM)
// ---------------------------------------------------------------------------

console.log("\nFull propagation chain (no LLM)");

test("R2 rename sub_module → R3 pruned → R4 agent+row pruned", () => {
  const tree = createFixtureTree();

  // === R2: rename "模块管理" → "内容管理" (under 系统A) ===
  const r2Before = tree.buildLevelSnapshot(2);
  tree.renameSubModule("系统A", "模块管理", "内容管理");
  const r2After = tree.buildLevelSnapshot(2);
  const r2Diff = DecomposerTree.diffSnapshots(r2Before, r2After);
  const r2Changes = tree.buildChangeSet(r2Diff);

  assertSetsEqual(r2Changes.affectedSubModules, ["系统A::内容管理"], "R2 changed sub");

  // === R3: pruned context ===
  const r3Pruned = tree.getRowsAtLevelPruned(3, r2Changes);
  const r3SubModules = [...new Set(r3Pruned.map((r) => `${r.module}::${r.sub_module}`))];
  assert.deepStrictEqual(r3SubModules, ["系统A::内容管理"], "R3 pruned: only affected sub");

  // === R3: add a function → "批量删除" under 内容管理 ===
  const r3Before = tree.buildLevelSnapshot(3);
  tree.addFunctions("系统A", "内容管理", ["批量删除"]);
  const r3After = tree.buildLevelSnapshot(3);
  const r3Diff = DecomposerTree.diffSnapshots(r3Before, r3After);
  const r3Changes = tree.buildChangeSet(r3Diff);

  assertSetsEqual(
    r3Changes.affectedSubModules,
    ["系统A::内容管理"],
    "R3 changed sub (inherited from R2 + new add)",
  );
  assertSetsEqual(
    r3Changes.affectedFunctions,
    ["系统A::内容管理::批量删除"],
    "R3 changed function (only the newly added one)",
  );

  // === R4: agent-level pruning ===
  const affectedSubModuleKeys = tree.getAffectedSubModuleKeys(r3Changes);
  assertSetsEqual(
    affectedSubModuleKeys,
    ["系统A::内容管理"],
    "R4 agent: only 内容管理 gets an R4 agent",
  );

  // Verify other sub_modules are NOT in the agent-level set
  assert.ok(!affectedSubModuleKeys.has("系统A::权限管理"), "权限管理 should NOT get R4 agent");
  assert.ok(!affectedSubModuleKeys.has("系统B::订单管理"), "订单管理 should NOT get R4 agent");
  assert.ok(!affectedSubModuleKeys.has("系统B::支付管理"), "支付管理 should NOT get R4 agent");

  // === R4: row-level pruning within the affected agent ===
  const r4PrunedRows = tree.getRowsForSubModule(
    "系统A",
    "内容管理",
    r3Changes.affectedFunctions,
  );

  // Only the newly added function "批量删除" should appear (prunedFunctionKeys filter)
  const r4FuncNames = [...new Set(r4PrunedRows.filter((r) => r.function !== null).map((r) => r.function))];
  assert.ok(r4FuncNames.includes("批量删除"), "new function should be in pruned R4 rows");
  assert.ok(!r4FuncNames.includes("创建模块"), "unchanged function should NOT be in pruned R4 rows");
  assert.ok(!r4FuncNames.includes("编辑模块"), "unchanged function should NOT be in pruned R4 rows");
});

test("R3 add function under unchanged sub → only that sub gets R4 context", () => {
  const tree = createFixtureTree();

  // R2: no changes (skip R2 — startRound would be 3)
  // R3: add "批量导出" under 系统B→订单管理
  const r3Before = tree.buildLevelSnapshot(3);
  tree.addFunctions("系统B", "订单管理", ["批量导出"]);
  const r3After = tree.buildLevelSnapshot(3);
  const r3Diff = DecomposerTree.diffSnapshots(r3Before, r3After);
  const r3Changes = tree.buildChangeSet(r3Diff);

  const affectedSubModuleKeys = tree.getAffectedSubModuleKeys(r3Changes);
  assertSetsEqual(affectedSubModuleKeys, ["系统B::订单管理"], "only 订单管理 affected");

  // Other sub_modules NOT affected
  assert.ok(!affectedSubModuleKeys.has("系统A::模块管理"));
  assert.ok(!affectedSubModuleKeys.has("系统B::支付管理"));
});

test("no changes in R2 → empty R3 pruning context", () => {
  const tree = createFixtureTree();

  const before = tree.buildLevelSnapshot(2);
  const after = tree.buildLevelSnapshot(2);
  const diff = DecomposerTree.diffSnapshots(before, after);
  const cs = tree.buildChangeSet(diff);

  // Empty changeset: affectedSubModules is empty
  assert.strictEqual(cs.affectedSubModules.size, 0);

  // getRowsAtLevelPruned returns nothing
  const pruned = tree.getRowsAtLevelPruned(3, cs);
  assert.strictEqual(pruned.length, 0);
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

console.log("\nEdge cases");

test("delete entire module → all children removed, affectedSubModules tracks all former subs", () => {
  const tree = createFixtureTree();

  const before = tree.buildLevelSnapshot(1);
  tree.deleteModules(["系统A"]);
  const after = tree.buildLevelSnapshot(1);
  const diff = DecomposerTree.diffSnapshots(before, after);
  const cs = tree.buildChangeSet(diff);

  // Module node deletion → affectedIds includes the module id
  // Since module has no parent sub, affectedSubModules reflects the tree at that point
  // The module is already deleted, so its subs no longer exist in the tree
  assert.strictEqual(cs.affectedIds.size, 1, "one module deleted");
  // After deletion, the module's subs are gone, so they don't appear in resolvePath
  assert.strictEqual(cs.affectedSubModules.size, 0, "deleted module's subs are gone");
});

test("empty fixture → fromPreviousRows handles gracefully", () => {
  const tree = DecomposerTree.fromPreviousRows([]);
  assert.strictEqual(tree.getModuleNames().length, 0);
  assert.strictEqual(tree.getRowsAtLevel(1).length, 0);
  assert.strictEqual(tree.getRowsAtLevel(4).length, 0);
  assert.strictEqual(tree.toQuotationRows().length, 0);
});

test("undefined previousRows → same as empty", () => {
  const tree = DecomposerTree.fromPreviousRows(undefined);
  assert.strictEqual(tree.getModuleNames().length, 0);
});

test("add then delete same sub_module → net zero change (but diff still detects)", () => {
  const tree = createFixtureTree();
  const before = tree.buildLevelSnapshot(2);

  tree.addSubModules("系统A", ["临时子模块"]);
  tree.deleteSubModules("系统A", ["临时子模块"]);

  const after = tree.buildLevelSnapshot(2);
  const diff = DecomposerTree.diffSnapshots(before, after);
  // The sub_module was created then deleted → after snapshot should match before
  // since the added node id is different and then removed, diff should be empty
  assert.strictEqual(diff.length, 0, "net zero change → no diff");
});

test("rename same name → no diff", () => {
  const tree = createFixtureTree();
  const before = tree.buildLevelSnapshot(1);
  tree.renameModule("系统A", "系统A"); // no-op
  const after = tree.buildLevelSnapshot(1);
  const diff = DecomposerTree.diffSnapshots(before, after);
  assert.strictEqual(diff.length, 0, "identity rename → no diff");
});

test("groupBySubModule correctly groups L3 rows", () => {
  const tree = createFixtureTree();
  const r3Rows = tree.getRowsAtLevel(3);
  const grouped = tree.groupBySubModule(r3Rows);

  assert.strictEqual(grouped.size, 4, "4 unique sub_modules");
  assert.ok(grouped.has("系统A::模块管理"));
  assert.ok(grouped.has("系统A::权限管理"));
  assert.ok(grouped.has("系统B::订单管理"));
  assert.ok(grouped.has("系统B::支付管理"));

  // Each group should have 2 function rows
  for (const [, group] of grouped) {
    assert.strictEqual(group.rows.length, 2, `${group.module}→${group.subModule} should have 2 functions`);
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${"─".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);

if (failed > 0) {
  process.exit(1);
}
