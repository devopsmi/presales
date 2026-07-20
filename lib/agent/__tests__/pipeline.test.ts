import { createPipeline, type PipelineInput } from "@/lib/agent/pipeline";
import type {
  PipelineEvent,
  QuotationHeader,
  QuotationRow,
} from "@/lib/agent/state";
import type { TradeRole } from "@/lib/constants";

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
// Fixture (same as nodes test)
// ---------------------------------------------------------------------------

const FIXTURE_RAW_TEXT =
  "做一个电商小程序，包含商品展示、购物车、支付功能";
const FIXTURE_SELECTED_TRADES: TradeRole[] = ["frontend", "backend", "design"];
const FIXTURE_BUDGET_RANGE: [number, number] = [50000, 150000];

function buildInput(): PipelineInput {
  return {
    rawText: FIXTURE_RAW_TEXT,
    attachments: [],
    selectedTrades: FIXTURE_SELECTED_TRADES,
    budgetRange: FIXTURE_BUDGET_RANGE,
    modelProvider: "mock",
    llmProvider: "mock",
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAgentStart(
  event: PipelineEvent,
): event is Extract<PipelineEvent, { type: "agent_start" }> {
  return event.type === "agent_start";
}

function isAgentComplete(
  event: PipelineEvent,
): event is Extract<PipelineEvent, { type: "agent_complete" }> {
  return event.type === "agent_complete";
}

function isPipelineComplete(
  event: PipelineEvent,
): event is Extract<PipelineEvent, { type: "pipeline_complete" }> {
  return event.type === "pipeline_complete";
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

async function testPipeline(): Promise<void> {
  console.log("\n--- Test: Pipeline ---");

  const events: PipelineEvent[] = [];
  for await (const event of createPipeline(buildInput())) {
    events.push(event);
  }

  // 1) Total event count
  assert(events.length >= 12, `pipeline emits at least 12 events (got ${events.length})`);

  // 2) agent_start for each agent in order
  const starts = events.filter(isAgentStart).map((e) => e.agent);
  const expectedStarts = ["parser", "decomposer", "estimator", "quoter"];
  const startsInOrder =
    starts.length === expectedStarts.length &&
    expectedStarts.every((agent, idx) => starts[idx] === agent);
  assert(
    startsInOrder,
    `agent_start sequence: parser → decomposer → estimator → quoter (got [${starts.join(", ")}])`,
  );

  // 3) agent_complete for all 4 agents
  const completes = events.filter(isAgentComplete).map((e) => e.agent);
  const expectedCompletes = ["parser", "decomposer", "estimator", "quoter"];
  const allComplete = expectedCompletes.every((a) => completes.includes(a));
  assert(
    allComplete,
    `agent_complete emitted for all 4 agents (got [${completes.join(", ")}])`,
  );

  // 4) Exactly one pipeline_complete
  const pipelineCompletes = events.filter(isPipelineComplete);
  assert(pipelineCompletes.length === 1, `exactly one pipeline_complete event (got ${pipelineCompletes.length})`);

  // 5) Strict ordering: for each agent, start must precede its complete,
  //    and the sequence of (start, complete) pairs must follow parser→decomposer→estimator→quoter.
  const sequence: string[] = [];
  for (const event of events) {
    if (event.type === "agent_start") sequence.push(`start:${event.agent}`);
    else if (event.type === "agent_complete") sequence.push(`complete:${event.agent}`);
  }
  const expectedSequence = [
    "start:parser",
    "complete:parser",
    "start:decomposer",
    "complete:decomposer",
    "start:estimator",
    "complete:estimator",
    "start:quoter",
    "complete:quoter",
  ];
  // Check expected sequence appears as a contiguous subsequence within the recorded sequence.
  let seqMatches = true;
  let cursor = 0;
  for (const tag of expectedSequence) {
    const idx = sequence.indexOf(tag, cursor);
    if (idx === -1) {
      seqMatches = false;
      break;
    }
    cursor = idx + 1;
  }
  assert(
    seqMatches,
    `events in correct order: parser start → parser complete → decomposer start → ... → quoter complete (sequence=[${sequence.join(", ")}])`,
  );

  // 6) pipeline_complete contains quotation with header and rows
  if (pipelineCompletes.length === 1) {
    const pc = pipelineCompletes[0];
    assert(pc !== undefined, "pipeline_complete event is defined");
    const quotation = pc.quotation;
    assert(quotation !== undefined, "pipeline_complete.quotation exists");

    if (quotation) {
      const header: QuotationHeader = quotation.header;
      assert(typeof header === "object" && header !== null, "quotation.header is an object");
      if (header && typeof header === "object") {
        assert(typeof header.customerName === "string" && header.customerName.length > 0,
          `header.customerName is non-empty string (got "${header.customerName}")`);
        assert(typeof header.projectName === "string" && header.projectName.length > 0,
          `header.projectName is non-empty string (got "${header.projectName}")`);
        assert(typeof header.quoteDate === "string" && header.quoteDate.length > 0,
          `header.quoteDate is non-empty string (got "${header.quoteDate}")`);
        assert(typeof header.vendorName === "string" && header.vendorName.length > 0,
          `header.vendorName is non-empty string (got "${header.vendorName}")`);
      }

      const rows: QuotationRow[] = quotation.rows;
      assert(Array.isArray(rows), "quotation.rows is an array");
      assert(rows.length > 0, `quotation.rows is non-empty (got ${rows.length})`);

      if (rows.length > 0) {
        const firstRow = rows[0];
        assert(firstRow !== undefined, "first row is defined");
        if (firstRow) {
          assert(typeof firstRow.module === "string" && firstRow.module.length > 0,
            `first row module is non-empty (got "${firstRow.module}")`);
          assert(typeof firstRow.function === "string" && firstRow.function.length > 0,
            `first row function is non-empty (got "${firstRow.function}")`);
          assert(firstRow.category === "design" || firstRow.category === "feature",
            `first row category is design|feature (got "${firstRow.category}")`);
        }
      }
    }
  }

  // 7) pipeline_complete comes after all agent_complete events
  const lastAgentCompleteIdx = (() => {
    let idx = -1;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev && ev.type === "agent_complete") idx = i;
    }
    return idx;
  })();
  const firstPipelineCompleteIdx = events.findIndex(isPipelineComplete);
  assert(
    firstPipelineCompleteIdx > lastAgentCompleteIdx,
    `pipeline_complete comes after all agent_complete (last_complete=${lastAgentCompleteIdx}, pipeline_complete=${firstPipelineCompleteIdx})`,
  );

  // 8) Sanity: parser's agent_complete populated customerName / projectName
  const parserComplete = events.find(
    (e) => isAgentComplete(e) && e.agent === "parser",
  );
  if (parserComplete && isAgentComplete(parserComplete)) {
    const out = parserComplete.output;
    assert(typeof out.customerName === "string" && (out.customerName as string).length > 0,
      `parser agent_complete has customerName (got "${String(out.customerName)}")`);
    assert(typeof out.projectName === "string" && (out.projectName as string).length > 0,
      `parser agent_complete has projectName (got "${String(out.projectName)}")`);
  }

  // 9) Decomposer emitted a non-zero row count
  const decomposerComplete = events.find(
    (e) => isAgentComplete(e) && e.agent === "decomposer",
  );
  if (decomposerComplete && isAgentComplete(decomposerComplete)) {
    const rowCount = decomposerComplete.output.rowCount;
    assert(typeof rowCount === "number" && rowCount > 0,
      `decomposer produced rows (rowCount=${String(rowCount)})`);
  }
}

testPipeline()
  .then(() => {
    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((err: unknown) => {
    console.error("Pipeline test threw:", err);
    process.exit(1);
  });