# components/agent-elements/ — Agent Chat UI Toolkit

## OVERVIEW

React 19 component library providing a complete agent chat UI surface: message list, streaming text, tool call cards, input bar, file previews. Built on shadcn/ui primitives + Tailwind v4. Integrated via `AgentChat` top-level component.

## STRUCTURE

```
agent-elements/
├── agent-chat.tsx         # Top-level AgentChat component (renders children)
├── agent-ui.css           # Shared styles
├── input-bar.tsx          # Message input with attachment/file support
├── message-list.tsx       # Renders message list with tool cards
├── markdown.tsx           # Markdown renderer (streamdown-based)
├── tools/                 # Tool card renderers (plan, question, subagent, default)
├── input/                 # Input sub-components (mentions, file previews)
├── hooks/                 # useAutoScroll, useChatStream (Vercel AI SDK bridge)
├── types.ts              # Shared component prop types
├── types/                 # Additional type definitions
├── utils/                 # Shared utilities
├── icons.tsx / icons/     # Icon components
├── question/              # QuestionTool UI (clarification flow)
└── user-message.tsx       # User message bubble rendering
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Tool card rendering | `tools/` | Map tool names → React components |
| SSE streaming | `hooks/` | Bridge Vercel AI SDK `useChat` to internal stream |
| Input bar behavior | `input-bar.tsx` + `input/` | File upload, text input, submit |
| Message layout | `message-list.tsx` | Main message renderer with auto-scroll |
| Custom tool renderer | `tools/` — add new component + register in `agent-chat.tsx` | Follow existing SubagentTool pattern |

## CONVENTIONS

- **Streaming**: Uses custom `SseMessage` wire format (NOT AI SDK defaults) — see `lib/types.ts`
- **Tool name mapping**: Frontend maps LangChain tool names to renderer keys (e.g., `parse_files` → `Subagent_File_Parser`)
- **CSS**: Tailwind v4 utility classes only; custom CSS in `agent-ui.css` for complex interactions
- **Client components**: All are `"use client"` — imported by `components/presales/agent-chat-panel.tsx`

## ANTI-PATTERNS

- **DO NOT** import server-only modules (LangChain, fs) — agent-elements is client-only
- **DO NOT** use `console.log` — use parent-provided logger or event callbacks
- **DO NOT** add new dependencies without checking `package.json` first
