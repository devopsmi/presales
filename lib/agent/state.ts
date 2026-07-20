import { Annotation } from "@langchain/langgraph";
import type { TradeRole } from "@/lib/constants";

/**
 * LangGraph state annotation — maps 1:1 to PipelineState fields.
 * Each key uses a default LastValue channel (most recent write wins).
 */
export const GraphStateAnnotation = Annotation.Root({
  rawText: Annotation<string>,
  attachments: Annotation<Attachment[]>,
  selectedTrades: Annotation<TradeRole[]>,
  budgetRange: Annotation<[number, number]>,
  modelProvider: Annotation<string>,
  customerName: Annotation<string>,
  projectName: Annotation<string>,
  structuredBrief: Annotation<string>,
  rows: Annotation<QuotationRow[]>,
  quotationFile: Annotation<Buffer | null>,
  /** Serialized quotation JSON for frontend consumption */
  quotationJson: Annotation<string>,
  currentAgent: Annotation<string>,
  error: Annotation<string | null>,
});

/** Inferred LangGraph state type */
export type GraphState = typeof GraphStateAnnotation.State;

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
  quotationJson: string;

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
    quotationJson: "",
    currentAgent: "idle",
    error: null,
  };
}
