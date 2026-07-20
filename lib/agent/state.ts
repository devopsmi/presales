import type { TradeRole } from "@/lib/constants";

export interface Attachment {
  name: string;
  type: "pdf" | "word" | "excel";
  content: string;
}

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

export interface QuotationHeader {
  customerName: string;
  projectName: string;
  quoteDate: string;
  vendorName: string;
}

export interface PipelineState {
  rawText: string;
  attachments: Attachment[];
  selectedTrades: TradeRole[];
  budgetRange: [number, number];
  modelProvider: string;

  customerName: string;
  projectName: string;

  structuredBrief: string;
  rows: QuotationRow[];

  quotationFile: Buffer | null;

  currentAgent: string;
  error: string | null;
}

export type PipelineEvent =
  | { type: "agent_start"; agent: string }
  | { type: "agent_progress"; agent: string; message: string }
  | { type: "agent_complete"; agent: string; output: Record<string, unknown> }
  | { type: "pipeline_complete"; quotation: { header: QuotationHeader; rows: QuotationRow[] } };

export function createInitialState(input: {
  rawText: string;
  attachments: Attachment[];
  selectedTrades: TradeRole[];
  budgetRange: [number, number];
  modelProvider: string;
}): PipelineState {
  return {
    rawText: input.rawText,
    attachments: input.attachments,
    selectedTrades: input.selectedTrades,
    budgetRange: input.budgetRange,
    modelProvider: input.modelProvider,
    customerName: "",
    projectName: "",
    structuredBrief: "",
    rows: [],
    quotationFile: null,
    currentAgent: "idle",
    error: null,
  };
}
