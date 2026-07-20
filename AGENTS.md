# AGENTS.md — 方案设计与报价Agent

AI-driven presales quotation system. User submits product requirements via chat → system auto-generates feature breakdown + pricing table.

## Quick commands

```bash
pnpm dev              # dev server (http://localhost:3000)
pnpm build            # production build
pnpm typecheck        # tsc --noEmit
pnpm lint             # ESLint (flat config)
pnpm test             # all tests (parser → xlsx → nodes → pipeline)
pnpm test:parser      # file parser tests only
pnpm test:xlsx        # xlsx generator tests only
pnpm test:nodes       # agent node integration tests
pnpm test:pipeline    # full pipeline integration test
```

**Mock mode (default):** `pnpm dev` works without any API key. Set `LLM_PROVIDER=openai` + `OPENAI_API_KEY` for real LLM (not yet fully implemented — see `resolveLlm` in pipeline.ts).

## Architecture (critical: NOT LangGraph)

Despite README/docs mentioning "LangGraph", the pipeline is a **custom async generator chain**, NOT a LangGraph StateGraph. No LangGraph imports exist in the code. The `@langchain/core` and `@langchain/openai` deps are installed but only the OpenAI integration is a TODO stub.

```
app/api/chat/route.ts
  └── createPipeline()  →  async generator yielding PipelineEvent
        ├── Agent-1: parser (raw text → structured brief)
        ├── Agent-2: decomposer (brief → QuotationRow[])
        ├── Agent-3: estimator (fills trades man-days into rows)
        └── Agent-4: quoter (header + pipeline_complete event)
```

### Pipeline node pattern (every node follows this)

```typescript
// Every node is an async generator:
export async function* runXxxNode(
  state: PipelineState,
  runLlm: RunLlmFn,
): AsyncGenerator<PipelineEvent, Partial<PipelineState>> {
  yield { type: "agent_start", agent: "xxx" };
  yield { type: "agent_progress", agent: "xxx", message: "..." };
  const output = await runLlm({ systemPrompt, userPrompt, agentName: "xxx", state });
  yield { type: "agent_complete", agent: "xxx", output: { ... } };
  return { /* Partial<PipelineState> — fields to merge */ };
}
```

### State mutation (important)

`PipelineState` is **mutated in-place** inside `createPipeline()`. The `drainNode()` helper calls `onAgentComplete` callbacks that write to `state.rows`, `state.customerName`, etc. directly. Node return values (Partial<PipelineState>) are also merged via property checks. This is NOT immutable/Redux-style — it's imperative state updates.

### Mock LLM (`lib/agent/mock-llm.ts`)

Deterministic per-agent-name outputs. When adding a new agent node, you MUST add a case in `runMockLlm()`'s switch statement. Uses `seededManDay()` for deterministic pseudo-random man-day estimates.

### SSE streaming format

The chat route uses a **custom SSE format**, NOT the standard Vercel AI SDK `streamText` format:
```
data: {"type":"text-delta","textDelta":"...","id":"msg-xxx"}\n\n
data: {"type":"finish","finishReason":"stop"}\n\n
```

Quotation data is embedded as: `__QUOTATION__{json}__END_QUOTATION__`. The frontend's `useChat` hook parses this custom format — do NOT replace with standard AI SDK streaming without updating both ends.

### Chat API config protocol

The frontend sends user messages with `__PRESALES_CONFIG__` markers:
```
__PRESALES_CONFIG__{"trades":["frontend","backend"],"budgetRange":[0,50000],"model":"deepseek-v3"}__END_CONFIG__
actual user message text here
```

This is parsed in `route.ts` via `parseConfig()`. When modifying the chat API, preserve this protocol.

## Key types

| Type | Location | Notes |
|------|----------|-------|
| `PipelineState` | `lib/agent/state.ts` | Central state flowing through pipeline |
| `QuotationRow` | `lib/agent/state.ts` | 5-level hierarchy: module → sub_module → function → sub_function → description |
| `PipelineEvent` | `lib/agent/state.ts` | Union: agent_start, agent_progress, agent_complete, pipeline_complete |
| `TradeRole` | `lib/constants.ts` | `"frontend" \| "backend" \| "design" \| "testing" \| "pm" \| "devops" \| "data" \| "ai"` |
| `Industry` | `lib/constants.ts` | `"电商" \| "金融" \| "医疗" \| "教育" \| "政务" \| "IoT" \| "SaaS" \| "其他"` |

## Directory map

```
app/
  api/chat/route.ts          # POST — SSE pipeline stream (custom format)
  api/quotation/export/route.ts  # POST — xlsx download
  page.tsx                   # 60/40 split layout (chat left, results right)
  layout.tsx                 # RootLayout with TooltipProvider, Inter + Geist fonts
lib/
  agent/
    pipeline.ts              # createPipeline() — serial async generator chain
    state.ts                 # PipelineState, PipelineEvent, QuotationRow, Attachment
    mock-llm.ts              # Deterministic mock per agentName
    nodes/                   # 4 agent nodes (all async generators)
    tools/file-parser.ts     # PDF/Word/Excel extraction
    tools/xlsx-generator.ts  # exceljs-based .xlsx generation
    prompts/*.md             # System prompts (Chinese) for each agent
    __tests__/               # pipeline.test.ts — tsx runner, NOT vitest
  constants.ts               # TRADES, INDUSTRIES, BUDGET_PRESETS, AVAILABLE_MODELS, VENDOR_NAME
  presales-context.tsx       # React Context (usePresales) — localStorage persistence
  utils.ts                   # cn() — clsx + tailwind-merge
components/
  presales/                  # Business components (10 files)
    agent-chat-panel.tsx     # useChat integration + E2E pipeline wiring
    result-panel.tsx         # Quotation display with empty state
    quotation-table.tsx      # shadcn Table with rowSpan merging + dynamic trade columns
    config-bar.tsx           # Combines 4 controls
    trade-selector.tsx       # Industry tabs + multi-select trades
    budget-slider.tsx        # Dual-range budget slider
    file-upload-menu.tsx     # Dropdown for PDF/Word/Excel upload
    model-picker.tsx         # LLM model selector
    quotation-header.tsx     # Customer/project/vendor info display
    export-buttons.tsx       # xlsx download (PDF placeholder)
  agent-elements/            # Local copy from shadcn registry (41 files)
  ui/                        # shadcn primitives (16 components)
```

## Testing quirks

- Tests use **`tsx` runner** directly (e.g. `tsx lib/agent/__tests__/pipeline.test.ts`), NOT vitest.
- `vitest` is in devDependencies but not used by any test script.
- Tests are plain `.ts` files with manual assertions (no test framework).
- Run order matters: `pnpm test` runs parser → xlsx → nodes → pipeline sequentially.

## Component conventions

- **All business components are client components** (`"use client"` directive).
- shadcn/ui uses `base-nova` style, `neutral` color, CSS variables, lucide icons, RSC mode.
- `PresalesProvider` wraps the entire app in `page.tsx` — access state anywhere via `usePresales()`.
- The chat panel uses `useChat` from `@ai-sdk/react` with custom `onToolCall` + `onFinish` handlers to detect quotation data in the stream.
- Empty states are shown when `quotation === null` (initial) vs `quotation.length === 0` (no results).

## Environment

- No `.env` files committed (all in `.gitignore`).
- `LLM_PROVIDER`: `"mock"` (default) or `"openai"`.
- `OPENAI_API_KEY`: required when LLM_PROVIDER=openai.
- `VENDOR_NAME` hardcoded in `lib/constants.ts`: `"重庆酷小贝软件开发有限公司"`.

## Style / conventions

- Tailwind CSS v4 with `@tailwindcss/postcss` plugin.
- CSS custom properties (oklch colors) defined in `app/globals.css`.
- Dark mode via `.dark` class — `next-themes` is installed but theme toggle not yet implemented.
- Path alias: `@/*` → `./*` (tsconfig paths).
- ESLint flat config: `eslint-config-next/core-web-vitals` + `typescript`, with `globalIgnores`.
- The app is entirely in Chinese (UI labels, prompts, constants).

## When adding a new agent node

1. Create `lib/agent/nodes/new-node.ts` following the async generator pattern (see parser.ts).
2. Add system prompt in `lib/agent/prompts/new-node.md`.
3. Add mock output case in `lib/agent/mock-llm.ts` switch statement.
4. Wire into `createPipeline()` in `lib/agent/pipeline.ts` via `drainNode()`.
5. Update `PipelineState` in `state.ts` if new fields are needed.
6. Add tests in `lib/agent/nodes/__tests__/`.
