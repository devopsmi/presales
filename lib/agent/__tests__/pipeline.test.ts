import { resolveLlm } from "@/lib/agent/llm";
import { streamPipeline, type PipelineInput } from "@/lib/agent/pipeline";
import type {
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
// Fixture
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
// Test
// ---------------------------------------------------------------------------

async function testPipeline(): Promise<void> {
  console.log("\n--- Test: Pipeline ---");

  const runLlm = resolveLlm("mock");
  const events: Array<{ type: string; agent?: string; delta?: string; finishReason?: string; error?: string }> = [];

  for await (const msg of streamPipeline(buildInput(), runLlm)) {
    events.push(msg);
  }

  const customEvents = events
    .filter(e => e.type === "text-delta" && e.delta)
    .map(e => e.delta!);

  // 1) Contains progress events
  assert(customEvents.length >= 4, `pipeline emits at least 4 text-delta chunks (got ${customEvents.length})`);

  // 2) Has agent_start for all 4 agents
  const startTexts = customEvents.filter(t => t.includes("开始工作"));
  assert(startTexts.length >= 4, `Has start events for all agents (got ${startTexts.length})`);

  // 3) Has agent_complete for all 4 agents
  const completeTexts = customEvents.filter(t => t.includes("完成。\n"));
  assert(completeTexts.length >= 4, `Has complete events for all agents (got ${completeTexts.length})`);

  // 4) pipeline_complete contains quotation data
  const quotationTexts = customEvents.filter(t => t.includes("__QUOTATION__"));
  assert(quotationTexts.length === 1, `Exactly one quotation marker (got ${quotationTexts.length})`);

  // 5) Parse and validate quotation
  if (quotationTexts.length === 1) {
    const qText = quotationTexts[0];
    const startIdx = qText.indexOf("__QUOTATION__");
    const endIdx = qText.indexOf("__END_QUOTATION__", startIdx + 13);
    if (endIdx !== -1) {
      const jsonStr = qText.slice(startIdx + 13, endIdx);
      const quotation = JSON.parse(jsonStr) as {
        header: QuotationHeader;
        rows: QuotationRow[];
      };

      assert(typeof quotation === "object" && quotation !== null, "quotation parsed as object");

      const header = quotation.header;
      assert(typeof header.customerName === "string" && header.customerName.length > 0,
        `header.customerName is non-empty (got "${header.customerName}")`);
      assert(typeof header.projectName === "string" && header.projectName.length > 0,
        `header.projectName is non-empty (got "${header.projectName}")`);
      assert(typeof header.quoteDate === "string" && header.quoteDate.length > 0,
        `header.quoteDate is non-empty (got "${header.quoteDate}")`);
      assert(typeof header.vendorName === "string" && header.vendorName.length > 0,
        `header.vendorName is non-empty (got "${header.vendorName}")`);

      const rows = quotation.rows;
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

  // 6) Exactly one finish event at end
  const finishEvents = events.filter(e => e.type === "finish");
  assert(finishEvents.length === 1, `exactly one finish event (got ${finishEvents.length})`);
  if (finishEvents.length === 1) {
    assert(finishEvents[0].finishReason === "stop", `finish reason is "stop"`);
  }

  // 7) finish event is last
  const lastEvent = events[events.length - 1];
  assert(lastEvent?.type === "finish", "finish event is last in stream");
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
