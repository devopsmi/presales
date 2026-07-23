# components/presales/ — Business UI Components

## OVERVIEW

Business-layer React components for the presales quotation system. All are `"use client"` components consuming `usePresales()` context. Covers config bar (trades, budget, model, files), agent chat integration, and quotation results display.

## COMPONENT INVENTORY

| Component | File | Role |
|-----------|------|------|
| `AgentChatPanel` | `agent-chat-panel.tsx` | Integrates AgentChat from agent-elements + config bar |
| `ConfigBar` | `config-bar.tsx` | Top bar: model picker, trades, budget, file upload |
| `TradeSelector` | `trade-selector.tsx` | Multi-select trade role picker |
| `BudgetSlider` | `budget-slider.tsx` | Dual-handle budget range slider with presets |
| `BudgetInput` | `budget-input.tsx` | Numeric budget value inputs |
| `ModelPicker` | `model-picker.tsx` | LLM model selector from config |
| `ModelConfigDialog` | `model-config-dialog.tsx` | Custom model configuration (baseUrl, apiKey, protocol) |
| `FileUploadMenu` | `file-upload-menu.tsx` | Dropdown with file upload trigger |
| `VendorNameInput` | `vendor-name-input.tsx` | Vendor/company name input |
| `EstimationPlanPicker` | `estimation-plan-picker.tsx` | Estimation strategy plan selector |
| `ResultPanel` | `result-panel.tsx` | Right panel container with quotation + export |
| `QuotationTable` | `quotation-table.tsx` | 5-level hierarchy table with trades columns |
| `QuotationHeader` | `quotation-header.tsx` | Customer/project/vendor info above the table |
| `ExportButtons` | `export-buttons.tsx` | XLSX/PDF export download buttons |

## CONVENTIONS

- **State**: All state via `usePresales()` context hook — no local state for shared config
- **Config sync**: Changes auto-sync to backend via `POST /api/config` (debounced via React useEffect)
- **Preferences**: User selections (trades, budget, model) persist to `localStorage` key `presales-preferences`
- **File handling**: `addAttachments()` / `removeAttachment()` on context; raw base64 sent to backend
- **Shadcn imports**: Import from `@/components/ui/` — never from `shadcn` package directly
- **Icons**: Use `lucide-react` for standard icons, `@tabler/icons-react` for special ones

## ANTI-PATTERNS

- **DO NOT** manage quotation state locally — always via `setQuotationResult()` on context
- **DO NOT** bypass `usePresales()` — every component inside `<PresalesProvider>` gets context
- **DO NOT** hardcode trade labels or rates — use `TRADES`/`TRADE_LABELS` from `@/lib/constants`
