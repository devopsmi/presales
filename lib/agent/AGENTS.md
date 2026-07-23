# lib/agent/ — Agent Pipeline

## OVERVIEW

LangChain-based agent pipeline implementing master-slave architecture. One master agent (6 tools) coordinates 3 sub-agents in a strict dispatch chain: FileParser → Decomposer → Estimator.

## STRUCTURE

```
lib/agent/
├── main-agent.ts          # Master agent: 6 tools, system prompt, session cache
├── llm.ts                 # LLM factory + model logging middleware
├── state.ts               # PipelineStage enum, sub-agent I/O types, StoredFile
├── sub-agents/
│   ├── file-parser.ts     # Parse attachments (PDF/Word/Excel) → text
│   ├── decomposer.ts      # BFS tree decomposition → QuotationRow[]
│   └── estimator.ts       # Fill per-trade man-day estimates
├── tools/
│   └── file-parser.ts     # File parsing tool implementations
└── skills/
    ├── grill-me.md        # 7-dimension requirement completeness check
    └── plans/             # Estimation strategy markdown files
```

## DISPATCH CHAIN

```
parse_files → query_file → grill_me → write_brief → decompose → estimate_hours
```

**Hard constraints:**
- `decompose` only after `write_brief`
- `estimate_hours` only after `decompose`
- `grill_me` before `write_brief` for requirement clarification; can also run after for final completeness check
- Stage enforced by `PipelineStage` enum: `idle → parsed → decomposed → estimated`

## SESSION ARCHITECTURE

- `PipelineCache` (per-session Map, max 100) — stores brief, rows, fileStore
- `agentCache` (per-model Map) — compiled LangGraph agents, one per model
- `sharedCheckpointer` (MemorySaver singleton) — keyed by `thread_id` (= sessionId)
- Tools resolve session via `config.configurable.thread_id`

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add a new tool | `main-agent.ts` — `buildXxxTool()` + add to `buildAgent()` | 6 existing: parse_files, query_file, write_brief, decompose, estimate_hours, grill_me |
| Change LLM behavior | `llm.ts` — `createModelInstance()` | Supports OpenAI protocol + Anthropic protocol |
| Add estimation plan | `skills/plans/` — create new `.md` file | Frontend picks via `estimationPlanId` |
| Change pipeline state | `state.ts` | `PipelineStageSchema`, sub-agent I/O types |

## CONVENTIONS

- Tool naming: NOT `subagent_xxx` — LangChain tool names are `parse_files`, `decompose`, etc.
- Tool name mapping for frontend: `mapToolName()` in `app/api/chat/route.ts`
- Session config: resolved at tool runtime via `getSessionConfig(sessionId)`, not at agent creation
- File ingestion: `ingestAttachments()` runs at agent creation, stores in `PipelineCache.fileStore`
- Reasoning model support: `extractStringContent()` handles `[{type:"reasoning",...},{type:"text",...}]` content blocks

## ANTI-PATTERNS

- **DO NOT** create agent per request — agents are cached in `agentCache`
- **DO NOT** pass `sessionId` directly to sub-agents — use `config.configurable.thread_id`
- **DO NOT** skip chain stages — tools validate `cache.stage` inline
