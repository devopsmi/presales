import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { createInitialState } from "@/lib/agent/state";
import type { GraphState, QuotationRow, PipelineEvent } from "@/lib/agent/state";
import type { TradeRole } from "@/lib/constants";
import { runMockLlm } from "@/lib/agent/mock-llm";
import { parserNode } from "@/lib/agent/nodes/parser";
import { decomposerNode } from "@/lib/agent/nodes/decomposer";
import { estimatorNode } from "@/lib/agent/nodes/estimator";
import { quoterNode } from "@/lib/agent/nodes/quoter";

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string): void {
  if (condition) {
    console.log(`  PASS: ${name}`);
    passed++;
  } else {
    console.error(`  FAIL: ${name}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const FIXTURE_RAW_TEXT = "做一个电商小程序，包含商品展示、购物车、支付功能";
const FIXTURE_SELECTED_TRADES: TradeRole[] = ["frontend", "backend", "design"];
const FIXTURE_BUDGET_RANGE: [number, number] = [50000, 150000];

function createFixtureState(): GraphState {
  const ps = createInitialState({
    rawText: FIXTURE_RAW_TEXT,
    attachments: [],
    selectedTrades: FIXTURE_SELECTED_TRADES,
    budgetRange: FIXTURE_BUDGET_RANGE,
    modelProvider: "mock",
  });
  return {
    rawText: ps.rawText,
    attachments: ps.attachments,
    selectedTrades: ps.selectedTrades,
    budgetRange: ps.budgetRange,
    modelProvider: ps.modelProvider,
    customerName: ps.customerName,
    projectName: ps.projectName,
    structuredBrief: ps.structuredBrief,
    rows: ps.rows,
    quotationFile: ps.quotationFile,
    quotationJson: ps.quotationJson,
    currentAgent: ps.currentAgent,
    error: ps.error,
  };
}

function recordingConfig(): { config: LangGraphRunnableConfig; events: PipelineEvent[] } {
  const events: PipelineEvent[] = [];
  const config: LangGraphRunnableConfig = {
    configurable: { runLlm: runMockLlm },
    writer: (data: unknown) => { events.push(data as PipelineEvent); },
  };
  return { config, events };
}

// ---------------------------------------------------------------------------
// Test: Parser
// ---------------------------------------------------------------------------

async function testParser(): Promise<Partial<GraphState>> {
  console.log("\n--- Test: Parser Node ---");

  const state = createFixtureState();
  const { config, events } = recordingConfig();

  const result = await parserNode(state, config);

  assert(
    typeof result.structuredBrief === "string" && result.structuredBrief.length > 0,
    "structuredBrief is a non-empty string",
  );
  assert(
    typeof result.customerName === "string" && result.customerName.length > 0,
    `customerName is non-empty: "${result.customerName ?? "undefined"}"`,
  );
  assert(
    typeof result.projectName === "string" && result.projectName.length > 0,
    `projectName is non-empty: "${result.projectName ?? "undefined"}"`,
  );
  assert(events.length >= 3, `Emitted at least 3 events (got ${events.length})`);

  const types = events.map(e => e.type);
  assert(
    types.includes("agent_start") && types.includes("agent_complete"),
    "Emitted agent_start and agent_complete events",
  );

  return result;
}

// ---------------------------------------------------------------------------
// Test: Decomposer
// ---------------------------------------------------------------------------

async function testDecomposer(parserResult: Partial<GraphState>): Promise<Partial<GraphState>> {
  console.log("\n--- Test: Decomposer Node ---");

  const base = createFixtureState();
  const state: GraphState = {
    ...base,
    structuredBrief: parserResult.structuredBrief ?? "",
    customerName: parserResult.customerName ?? "",
    projectName: parserResult.projectName ?? "",
  };

  const { config, events } = recordingConfig();
  const result = await decomposerNode(state, config);

  const rows: QuotationRow[] = result.rows ?? [];
  assert(rows.length >= 6, `rows has at least 6 items (got ${rows.length})`);
  assert(rows.length <= 12, `rows has at most 12 items (got ${rows.length})`);

  let allValid = true;
  for (const row of rows) {
    if (
      typeof row.seq !== "number" ||
      typeof row.module !== "string" || row.module.length === 0 ||
      typeof row.sub_module !== "string" ||
      typeof row.function !== "string" ||
      typeof row.sub_function !== "string" ||
      typeof row.description !== "string" || row.description.length === 0 ||
      (row.category !== "design" && row.category !== "feature") ||
      typeof row.trades !== "object" || row.trades === null ||
      typeof row.remark !== "string"
    ) {
      console.error(`    Invalid row structure at seq=${row.seq}:`, JSON.stringify(row));
      allValid = false;
    }
  }
  assert(allValid, "All rows have valid QuotationRow structure");

  const designRows = rows.filter((r) => r.category === "design");
  const featureRows = rows.filter((r) => r.category === "feature");
  assert(designRows.length > 0, `Has design rows (got ${designRows.length})`);
  assert(featureRows.length > 0, `Has feature rows (got ${featureRows.length})`);

  const firstFeatureIdx = rows.findIndex((r) => r.category === "feature");
  const lastDesignIdx = rows.map((r, i) => (r.category === "design" ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
  assert(
    firstFeatureIdx === -1 || lastDesignIdx === -1 || lastDesignIdx < firstFeatureIdx,
    "Design rows appear before feature rows",
  );

  const allTradesEmpty = rows.every((r) => {
    const entries = Object.entries(r.trades);
    return entries.length === 0 || entries.every(([, v]) => v === undefined || v === null);
  });
  assert(allTradesEmpty, "All trades are empty after decomposer");

  assert(events.length >= 3, `Emitted at least 3 events (got ${events.length})`);
  const types = events.map(e => e.type);
  assert(
    types.includes("agent_start") && types.includes("agent_complete"),
    "Emitted agent_start and agent_complete events",
  );

  return result;
}

// ---------------------------------------------------------------------------
// Test: Estimator
// ---------------------------------------------------------------------------

async function testEstimator(
  decomposerResult: Partial<GraphState>,
  customerName: string,
  projectName: string,
): Promise<Partial<GraphState>> {
  console.log("\n--- Test: Estimator Node ---");

  const base = createFixtureState();
  const state: GraphState = {
    ...base,
    rows: decomposerResult.rows ?? [],
    customerName,
    projectName,
  };

  const { config, events } = recordingConfig();
  const result = await estimatorNode(state, config);

  const rows: QuotationRow[] = result.rows ?? [];
  assert(rows.length > 0, `Estimator returned rows (got ${rows.length})`);

  const tradesFilledCount = rows.filter((r) => {
    const entries = Object.entries(r.trades);
    return entries.some(([, v]) => typeof v === "number" && v > 0);
  }).length;
  assert(tradesFilledCount > 0, `At least one row has non-null trade values (${tradesFilledCount} rows with estimates)`);

  let allTradeKeysValid = true;
  for (const row of rows) {
    for (const trade of Object.keys(row.trades)) {
      if (!FIXTURE_SELECTED_TRADES.includes(trade as TradeRole)) {
        console.error(`    Row ${row.seq} has unexpected trade key: "${trade}"`);
        allTradeKeysValid = false;
      }
    }
  }
  assert(allTradeKeysValid, "All trade keys in rows are from selectedTrades");

  const numericCount = rows.reduce((sum, r) => {
    return sum + Object.values(r.trades).filter((v) => typeof v === "number" && v > 0).length;
  }, 0);
  assert(numericCount > 0, `At least one numeric estimate across all rows (got ${numericCount})`);

  assert(events.length >= 3, `Emitted at least 3 events (got ${events.length})`);
  const types = events.map(e => e.type);
  assert(
    types.includes("agent_start") && types.includes("agent_complete"),
    "Emitted agent_start and agent_complete events",
  );

  return result;
}

// ---------------------------------------------------------------------------
// Test: Quoter
// ---------------------------------------------------------------------------

async function testQuoter(
  estimatorResult: Partial<GraphState>,
  customerName: string,
  projectName: string,
): Promise<Partial<GraphState>> {
  console.log("\n--- Test: Quoter Node ---");

  const base = createFixtureState();
  const state: GraphState = {
    ...base,
    rows: estimatorResult.rows ?? [],
    customerName,
    projectName,
    budgetRange: FIXTURE_BUDGET_RANGE,
  };

  const { config, events } = recordingConfig();
  const result = await quoterNode(state, config);

  const types = events.map(e => e.type);
  const hasPipelineComplete = types.includes("pipeline_complete");
  assert(hasPipelineComplete, "Emitted pipeline_complete event");

  assert(
    typeof result.customerName === "string" && result.customerName.length > 0,
    `Quoter returned customerName: "${result.customerName ?? "undefined"}"`,
  );
  assert(
    typeof result.projectName === "string" && result.projectName.length > 0,
    `Quoter returned projectName: "${result.projectName ?? "undefined"}"`,
  );

  assert(events.length >= 3, `Emitted at least 3 events (got ${events.length})`);

  return result;
}

// ---------------------------------------------------------------------------
// Main test runner
// ---------------------------------------------------------------------------

async function runAll(): Promise<void> {
  console.log("=== Pipeline Node Tests (Mock LLM) ===\n");

  try {
    // Step 1: Parser
    const parserResult = await testParser();

    // Step 2: Decomposer
    const decomposerResult = await testDecomposer(parserResult);

    // Step 3: Estimator
    const customerName = parserResult.customerName ?? "未指定客户";
    const projectName = parserResult.projectName ?? "未指定项目";
    const estimatorResult = await testEstimator(decomposerResult, customerName, projectName);

    // Step 4: Quoter
    await testQuoter(estimatorResult, customerName, projectName);

    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  } catch (err) {
    console.error("\nFATAL ERROR:", err);
    failed++;
    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

runAll();
