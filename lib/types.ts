/**
 * Shared types — used by frontend components, API routes, and agent pipeline.
 * Zero LangChain imports. Safe to import from anywhere.
 */
import type { TradeRole } from "@/lib/constants";

/** Per-trade daily rate overrides. Keys are TradeRole IDs; undefined entries fall back to TRADE_DAILY_RATES defaults. */
export type QuotedRates = Partial<Record<TradeRole, number>>;

// ---------------------------------------------------------------------------
// FileTab — uploaded file shown as a tab in the right panel
// ---------------------------------------------------------------------------

export interface FileTab {
  id: string;
  name: string;
  size: number;
  file: File;
  parsed?: string;
}
import type { ModelConfig } from "@/lib/session-config";

// ---------------------------------------------------------------------------
// Attachment — file attachments from the frontend
// ---------------------------------------------------------------------------

export interface Attachment {
  name: string;
  type: "pdf" | "word" | "excel" | "image";
  /** Parsed text content (filled by file-parse tools or pre-processing). */
  content: string;
  /** Base64-encoded raw file data from client; consumed by file-parse tools. */
  rawData?: string;
}

// ---------------------------------------------------------------------------
// QuotationRow — 5-level hierarchy with per-trade man-day estimates
// ---------------------------------------------------------------------------

export interface QuotationRow {
  seq: number;
  module: string;
  sub_module: string;
  function: string;
  sub_function: string;
  description: string;
  category: "design" | "feature";
  trades: Partial<Record<TradeRole, number | null>>;
  remark: string;
}

// ---------------------------------------------------------------------------
// QuotationHeader — quotation metadata
// ---------------------------------------------------------------------------

export interface QuotationHeader {
  customerName: string;
  projectName: string;
  quoteDate: string;
  vendorName: string;
}

// ---------------------------------------------------------------------------
// PipelineInput — what chat API route passes to the pipeline
// ---------------------------------------------------------------------------

export interface PipelineInput {
  rawText: string;
  attachments: Attachment[];
  selectedTrades: TradeRole[];
  budgetRange: [number, number];
  modelProvider: string;
  modelConfigs: ModelConfig[];
  llmProvider: "openai" | "anthropic";
  vendorName?: string;
}

// ---------------------------------------------------------------------------
// SseMessage — wire format between backend SSE and frontend useChat
// ---------------------------------------------------------------------------

export interface SseMessage {
  type:
    | "text-start"
    | "text-delta"
    | "text-end"
    | "finish"
    | "error"
    | "tool-input-start"
    | "tool-input-delta"
    | "tool-output-available";
  id?: string;
  finishReason?: string;
  error?: string;
  toolCallId?: string;
  toolName?: string;
  inputTextDelta?: string;
  delta?: string;
  output?: string;
}
