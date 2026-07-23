# PROJECT KNOWLEDGE BASE

**Generated:** 2026-07-23T03:18:42Z
**Commit:** 1e61848
**Branch:** lyq

## OVERVIEW

AI-driven presales quotation system. User describes a product via chat + file uploads; system delivers a 5-level feature breakdown with per-trade man-day estimates and cost.

**Stack:** Next.js 16 App Router + React 19 · shadcn/ui + Agent Elements · Tailwind CSS v4 · LangChain/LangGraph · Vercel AI SDK (SSE streaming)

## STRUCTURE

```
presales/
├── app/                    # Next.js App Router (page + API routes)
│   └── api/chat/route.ts   # SSE streaming chat endpoint
├── components/
│   ├── agent-elements/     # Agent chat UI toolkit (messages, tools, streaming)
│   ├── presales/           # Business components (config, quotation display)
│   └── ui/                 # shadcn base components (auto-generated)
├── lib/
│   ├── agent/              # Agent pipeline (main agent + 3 sub-agents + tools)
│   ├── constants.ts        # Trades, industries, daily rates, budget presets
│   ├── types.ts            # Shared types (QuotationRow, Attachment, SseMessage)
│   ├── session-config.ts   # Per-session config store (trades, model, budget)
│   ├── presales-context.tsx# React Context (global state + localStorage sync)
│   ├── xlsx-generator.ts   # ExcelJS quotation workbook builder
│   ├── file-utils.ts       # File type detection & validation
│   ├── logger.ts           # Structured logger (pretty dev / JSON prod)
│   └── utils.ts            # Misc helpers
├── docs/design.md          # Full system design document
└── .agents/skills/         # Custom skills (xlsx, agent-elements)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Agent pipeline logic | `lib/agent/main-agent.ts` | Master agent: tools, session cache, system prompt |
| Sub-agents | `lib/agent/sub-agents/` | FileParser, Decomposer, Estimator |
| API route (chat SSE) | `app/api/chat/route.ts` | Streams agent events to frontend |
| Business UI components | `components/presales/` | Config bar, quotation table, export buttons |
| Agent chat UI | `components/agent-elements/` | Message rendering, tool cards, input bar |
| Type definitions | `lib/types.ts` | `QuotationRow`, `Attachment`, `SseMessage` |
| Constants & rates | `lib/constants.ts` | 8 trades with daily rates, industry defaults |
| Frontend global state | `lib/presales-context.tsx` | `usePresales()` hook |
| XLSX export | `lib/xlsx-generator.ts` | `generateQuotationXlsx()` |
| LLM factory | `lib/agent/llm.ts` | `createModelInstance()` with OpenAI/Anthropic support |
| Session reset | `app/api/session/reset/` | Clears pipeline cache for session |

## CODE MAP

| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `createPresalesAgent` | function | `lib/agent/main-agent.ts:488` | Entry: builds/caches LangChain agent per model |
| `PresalesProvider` / `usePresales` | context | `lib/presales-context.tsx:147/283` | Global state: trades, budget, model, quotation |
| `generateQuotationXlsx` | function | `lib/xlsx-generator.ts:6` | Builds `.xlsx` workbook from QuotationRows |
| `createModelInstance` | function | `lib/agent/llm.ts:160` | LLM factory (OpenAI protocol / Anthropic / custom) |
| `getSessionConfig` | function | `lib/session-config.ts:34` | Per-session config from in-memory store |
| `runFileParser` | function | `lib/agent/sub-agents/file-parser.ts` | Sub-agent: parses attachments into structured brief |
| `runDecomposer` | function | `lib/agent/sub-agents/decomposer.ts` | Sub-agent: BFS tree → QuotationRow[] |
| `runEstimator` | function | `lib/agent/sub-agents/estimator.ts` | Sub-agent: fills per-trade man-days |
| `QuotationRow` | interface | `lib/types.ts:25` | 5-level hierarchy + trades map |
| `TRADES` / `TradeRole` | const/type | `lib/constants.ts:2/13` | 8 trade roles with daily rates |

## CONVENTIONS

- **Package manager**: pnpm (pnpm-workspace.yaml present)
- **Path alias**: `@/*` → project root (`tsconfig.json` paths)
- **Import style**: No barrel files; direct imports from source files
- **Validation**: Zod (`z.object`, `z.enum`) for runtime type checking
- **Logging**: `lib/logger.ts` — use `log.child({ctx})` for sub-loggers; never `console.log`
- **Error handling**: Try/catch with structured `log.error(msg, {error: err})`; never empty catch
- **Session identity**: `sessionId` flows through `config.configurable.thread_id` in LangChain, `localStorage` on client
- **File attachments**: Client sends base64 `rawData`; server parses to text via sub-agent tools
- **Agent caching**: Compiled LangGraph agents cached per model in `agentCache` Map; `MemorySaver` shared across requests
- **Config sync**: Frontend posts config to `/api/config` on change; backend reads from `session-config.ts` Map

## ANTI-PATTERNS (THIS PROJECT)

- **DO NOT** use `console.log` — use `lib/logger.ts` (structured logging)
- **DO NOT** import LangChain types in `lib/types.ts` — keep it framework-free for frontend imports
- **DO NOT** skip the dispatch chain: FileParser → Decomposer → Estimator is strictly sequential
- **DO NOT** call `createAgent()` per request — use cached agent from `agentCache`
- **DO NOT** pass `sessionId` directly to sub-agents — resolve via `config.configurable.thread_id`
- **NEVER** suppress type errors (`as any`, `@ts-ignore`)

## UNIQUE STYLES

- **SSE protocol**: Custom `SseMessage` types (text-start/delta/end, tool-input-start/delta, tool-output-available, finish) — NOT standard AI SDK streaming
- **Pipeline stages**: `"idle"` → `"parsed"` → `"decomposed"` → `"estimated"` — enforced via inline checks in tool functions
- **Grill-me skill**: Loaded from `lib/agent/skills/grill-me.md` at runtime via `fs.readFileSync`
- **Estimation plans**: Markdown skill files under `lib/agent/skills/plans/` — loaded by Estimator sub-agent
- **Mock mode**: `LLM_PROVIDER=mock` uses deterministic templates; no API keys needed

## COMMANDS

```bash
pnpm dev              # Next.js dev server (localhost:3000)
pnpm build            # Production build
pnpm typecheck        # tsc --noEmit
pnpm lint             # ESLint (next/core-web-vitals + typescript)
pnpm test             # Run all tests (xlsx + decomposer)
pnpm test:xlsx        # Excel generator test only
pnpm test:decomposer  # Decomposer sub-agent test only
```

## NOTES

- **No .env file committed** — env vars are `LLM_PROVIDER` (mock/openai), `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`
- **Client logs**: Written to `logs/` directory
- **Session cache**: Limited to 100 entries; oldest evicted on overflow; cleared on reset
- **Design doc**: `docs/design.md` has full architecture details (master-slave, BFS decomposition, SSE protocol)
