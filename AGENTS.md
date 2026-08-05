# PROJECT KNOWLEDGE BASE

**Updated:** 2026-08-05
**Branch:** lyq

## OVERVIEW

AI-driven presales quotation system. User describes a product via chat + file uploads; system delivers a 5-level feature breakdown with per-trade man-day estimates and cost.

**Stack:** Next.js 16 App Router + React 19 · shadcn/ui (base-nova style) + Agent Elements · Tailwind CSS v4 · LangChain/LangGraph · Vercel AI SDK (SSE streaming)

## STRUCTURE

```
presales/
├── app/                       # Next.js App Router
│   ├── api/chat/route.ts      # SSE streaming chat endpoint
│   ├── api/config/route.ts    # Session config sync API
│   ├── api/quotation/export/  # XLSX/PDF export API
│   ├── api/session/reset/     # Session pipeline cache reset
│   ├── api/decompose/progress/# Decomposer BFS-round polling
│   └── page.tsx               # Main page
├── components/
│   ├── agent-elements/        # Agent chat UI toolkit (messages, tools, streaming)
│   ├── presales/              # Business components (config, quotation, export)
│   └── ui/                    # shadcn base components (auto-generated)
├── lib/
│   ├── agent/                 # Agent pipeline (main agent + 4 sub-agents + tools)
│   │   ├── main-agent.ts      # Master agent: 6 tools, session cache, system prompt
│   │   ├── llm.ts             # LLM factory + model logging middleware
│   │   ├── state.ts           # PipelineStage enum, sub-agent I/O types, StoredFile
│   │   ├── sub-agents/        # FileParser, Decomposer, Evaluator, Estimator
│   │   │   └── decomposer/    # BFS decomposition: index, tools, agents, table, prompts
│   │   └── tools/             # file-parser.ts, read-rows.ts
│   ├── constants.ts           # 9 trades (w/daily rates), industries, budget presets
│   ├── types.ts               # Shared types (QuotationRow, Attachment, SseMessage)
│   ├── session-config.ts      # Per-session config store (trades, model, budget)
│   ├── presales-context.tsx   # React Context (global state + localStorage sync)
│   ├── xlsx-generator.ts      # ExcelJS quotation workbook builder
│   ├── prompt-defaults.ts     # Central prompt registry (945 lines — all LLM prompts)
│   ├── file-utils.ts          # File type detection & validation
│   ├── logger.ts              # Structured logger (colorized stdout + file to log/)
│   └── utils.ts               # Misc helpers
├── docs/design.md             # Full system design document
├── .agents/skills/            # OpenCode skills (agent-elements, xlsx)
└── presales.config.js         # PM2 deployment config (port 4001)
```

**Nested AGENTS.md files** (read these when working in these areas):
- `lib/agent/AGENTS.md` — agent pipeline details, tool naming, session architecture
- `components/presales/AGENTS.md` — business UI component inventory and conventions

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Agent pipeline logic | `lib/agent/main-agent.ts` | Master agent: 6 tools, session cache, system prompt |
| Sub-agents | `lib/agent/sub-agents/` | FileParser, Decomposer, Evaluator, Estimator |
| Decomposer internals | `lib/agent/sub-agents/decomposer/` | BFS agents, CRUD tools, DecomposerTree table |
| API route (chat SSE) | `app/api/chat/route.ts` | Streams agent events to frontend via custom SseMessage format |
| Business UI components | `components/presales/` | Config bar, quotation table, export buttons, model config |
| Agent chat UI | `components/agent-elements/` | Message rendering, tool cards, input bar |
| Type definitions | `lib/types.ts` | `QuotationRow`, `Attachment`, `SseMessage` — zero LangChain imports |
| Constants & rates | `lib/constants.ts` | 9 trades with daily rates, industry defaults, budget presets |
| Prompt management | `lib/prompt-defaults.ts` | All LLM prompt defaults; overridable via `promptOverrides` in session config |
| Frontend global state | `lib/presales-context.tsx` | `usePresales()` hook |
| XLSX export | `lib/xlsx-generator.ts` | `generateQuotationXlsx()` builds workbook from QuotationRows |
| LLM factory | `lib/agent/llm.ts` | `createModelInstance()` with OpenAI/Anthropic protocol support |
| Session reset | `app/api/session/reset/` | Clears pipeline cache for session |
| Pipeline state types | `lib/agent/state.ts` | `PipelineStage` enum, sub-agent I/O interfaces |

## CODE MAP

| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `createPresalesAgent` | function | `lib/agent/main-agent.ts` | Entry: builds/caches LangChain agent per model |
| `PresalesProvider` / `usePresales` | context | `lib/presales-context.tsx` | Global state: trades, budget, model, quotation |
| `generateQuotationXlsx` | function | `lib/xlsx-generator.ts` | Builds `.xlsx` workbook from QuotationRows |
| `createModelInstance` | function | `lib/agent/llm.ts` | LLM factory (OpenAI protocol / Anthropic protocol / custom) |
| `getSessionConfig` | function | `lib/session-config.ts` | Per-session config from in-memory Map |
| `resolvePrompt` | function | `lib/prompt-defaults.ts` | Resolves prompt content with override chain |
| `runFileParser` | function | `lib/agent/sub-agents/file-parser.ts` | Sub-agent: parses attachments → structured brief |
| `runDecomposer` | function | `lib/agent/sub-agents/decomposer/index.ts` | BFS tree decomposition → QuotationRow[] |
| `runEvaluator` | function | `lib/agent/sub-agents/evaluator.ts` | Fidelity check: decomposition vs original brief |
| `runEstimator` | function | `lib/agent/sub-agents/estimator.ts` | Fills per-trade man-days |
| `QuotationRow` | interface | `lib/types.ts:40` | 5-level hierarchy + per-trade man-days map |
| `TRADES` / `TradeRole` | const/type | `lib/constants.ts:2/14` | 9 trade roles with daily rates |

## PIPELINE

**Stages (strictly sequential):** `idle → parsed → decomposed → evaluated → estimated`

**Dispatch chain:** `parse_files → query_file → grill_me → decompose → evaluate → estimate_hours` (plus `read_rows` for row inspection)

**6 tools** on the master agent:
- `parse_files` — FileParser sub-agent
- `query_file` — read parsed file content by index
- `grill_me` — 7-dimension requirement completeness check (before/after decompose)
- `decompose` — BFS decomposition into 5-level QuotationRows
- `evaluate` — Evaluator sub-agent (fidelity check vs brief; can loop with decompose until passed)
- `estimate_hours` — Estimator sub-agent + quotation computation
- `read_rows` — inspect/modify rows by module/sub_module (usable after decompose)

## CONVENTIONS

- **Package manager**: pnpm
- **Path alias**: `@/*` → project root
- **Import style**: No barrel files; direct imports from source files
- **Validation**: Zod for runtime type checking; types and schemas in `lib/agent/state.ts`
- **Logging**: `lib/logger.ts` — use `log.child({ctx})` for sub-loggers; never `console.log`. Writes to `log/` directory (colorized stdout + plain-text file)
- **Error handling**: Try/catch with structured `log.error(msg, {error: err})`; never empty catch
- **Session identity**: `sessionId` flows through `config.configurable.thread_id` in LangChain, `localStorage` on client
- **File attachments**: Client sends base64 `rawData`; server parses to text via sub-agent tools
- **Agent caching**: Compiled LangGraph agents cached per model in `agentCache` Map; `MemorySaver` singleton shared across requests. Session cache (PipelineCache) limited to 100 entries.
- **Config sync**: Frontend posts config to `/api/config` on change; backend reads from `in-memory` Map
- **Prompt management**: All prompt defaults in `lib/prompt-defaults.ts`. Override per-session via `promptOverrides` in `SessionConfig`. Do NOT edit agent source files to change prompts — use the registry.
- **Tool naming**: LangChain tool names are `parse_files`, `decompose`, `evaluate`, `estimate_hours`, `grill_me`, `read_rows` — NOT `subagent_xxx`
- **Content extraction**: Use `extractStringContent()` from `lib/agent/llm.ts` for reasoning model output (handles `[{type:"reasoning"}, {type:"text"}]` blocks)
- **Decomposer progress**: Frontend polls `/api/decompose/progress?sessionId=...` during BFS rounds

## ANTI-PATTERNS

- **DO NOT** use `console.log` — use `lib/logger.ts` (structured logging)
- **DO NOT** import LangChain types in `lib/types.ts` — keep it framework-free for frontend imports
- **DO NOT** skip the dispatch chain: stages are enforced via `PipelineCache.stage` inline checks
- **DO NOT** call `createAgent()` per request — use cached agent from `agentCache`
- **DO NOT** pass `sessionId` directly to sub-agents — resolve via `config.configurable.thread_id`
- **DO NOT** edit agent source files to change prompts — use `prompt-defaults.ts` and `promptOverrides`
- **NEVER** suppress type errors (`as any`, `@ts-ignore`)

## UNIQUE STYLES

- **SSE protocol**: Custom `SseMessage` types (text-start/delta/end, tool-input-start/delta, tool-output-available, finish) — NOT standard AI SDK streaming
- **Pipeline stages**: `"idle"` → `"parsed"` → `"decomposed"` → `"evaluated"` → `"estimated"` — enforced via inline checks in tool functions
- **Evaluator loop**: `evaluate` checks decomposition fidelity; if not passed, `decompose` can be re-invoked; loop count tracked via `evaluateCount`
- **Decomposer BFS**: 4-round agent-based BFS with level-scoped CRUD tools on a shared `DecomposerTree`. Modification rounds with `roundInstructions` support targeted re-decomposition with propagation pruning.
- **Grill-me**: Default prompt loaded from `lib/agent/skills/grill-me.md` (fallback from file) or overridden via `promptOverrides.grill_me`. If the file is missing, the fallback string is used (Chinese: "Skill \"grill-me\" 未找到。").
- **Estimation plans**: Markdown files expected under `lib/agent/skills/plans/` — selectable via `estimationPlanId` in session config
- **Mock mode**: `LLM_PROVIDER=mock` uses deterministic templates; no API keys needed
- **Model config**: Frontend `ModelConfigDialog` allows custom baseUrl/apiKey/protocol per model; stored in session config for `createModelInstance()`

## COMMANDS

```bash
pnpm dev                # Next.js dev server (localhost:3000)
pnpm build              # Production build
pnpm start              # Production start (PM2 uses this on port 4001)
pnpm typecheck          # tsc --noEmit
pnpm lint               # ESLint (next/core-web-vitals + typescript)
pnpm test               # Run xlsx + decomposer tests
pnpm test:xlsx          # Excel generator test only
pnpm test:decomposer    # Decomposer sub-agent test only
pnpm test:agent         # Pipeline integration test (lib/agent/__tests__/)
```

## NOTES

- **No .env file committed** — env vars: `LLM_PROVIDER` (mock/openai/anthropic), `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `LOG_LEVEL` (debug/info/warn/error)
- **Server logs**: Written to `log/session-{timestamp}.log`; filtered via `LOG_LEVEL` env var
- **Session cache**: In-memory only; 100-entry limit; oldest evicted on overflow; cleared on reset
- **Design doc**: `docs/design.md` has full architecture details (master-slave, BFS decomposition, SSE protocol)
- **PM2 deploy**: `presales.config.js` — `pnpm start` on port 4001; autorestart enabled
- **External server packages**: `pdf-parse` and `@napi-rs/canvas` excluded from webpack bundling via `next.config.ts`
- **shadcn config**: `base-nova` style, `neutral` base color, CSS variables enabled, `lucide` icon library
