/**
 * Agent state & shared types for the presales pipeline.
 *
 * Uses Zod schemas for LangChain createAgent state integration.
 * PipelineStage enforces sequential execution via order-guard middleware.
 */
import { z } from "zod";
import type { TradeRole } from "@/lib/constants";
import type { QuotationRow, QuotationHeader } from "@/lib/types";

// ---------------------------------------------------------------------------
// Pipeline stage — strictly sequential
// ---------------------------------------------------------------------------

export const PipelineStageSchema = z.enum([
  "idle",
  "parsed",
  "decomposed",
  "evaluated",
  "estimated",
]);

export type PipelineStage = z.infer<typeof PipelineStageSchema>;

// ---------------------------------------------------------------------------
// Agent State — shared across main agent + middleware
// ---------------------------------------------------------------------------

export const AgentStateSchema = z.object({
  pipelineStage: PipelineStageSchema.default("idle"),
  structuredBrief: z.string().default(""),
  customerName: z.string().default(""),
  projectName: z.string().default(""),
  rows: z.array(z.any()).default([]),
  selectedTrades: z.array(z.string()).default([]),
  budgetRange: z.tuple([z.number(), z.number()]).default([0, 0]),
  vendorName: z.string().default(""),
});

export type AgentState = z.infer<typeof AgentStateSchema>;

// ---------------------------------------------------------------------------
// Sub-agent I/O types
// ---------------------------------------------------------------------------

export interface FileParserOutput {
  structuredBrief: string;
  customerName: string;
  projectName: string;
}

export interface DecomposerOutput {
  rows: QuotationRow[];
}

export interface EstimatorOutput {
  rows: QuotationRow[];
  header: QuotationHeader;
  quotationJson?: string;
}

export interface EvaluatorIssue {
  severity: "error" | "warning";
  /** 模块层级路径，如 "模块'C端'→子模块'订单'→功能'退款'"。遗漏项无 seq 前缀，用【缺失】标记。 */
  location: string;
  description: string;
}

export interface EvaluatorOutput {
  passed: boolean;
  issues: EvaluatorIssue[];
  summary: string;
}

export interface QuotationResult {
  header: QuotationHeader;
  rows: QuotationRow[];
  trades: TradeRole[];
}

// ---------------------------------------------------------------------------
// File store — indexed files stored in session cache
// ---------------------------------------------------------------------------

export interface StoredFile {
  index: number;
  name: string;
  type: "pdf" | "word" | "excel" | "image";
  body: string;
  parsed: string;
}

// ---------------------------------------------------------------------------
// Decomposer progress — emitted between BFS rounds for frontend polling
// ---------------------------------------------------------------------------

export interface DecomposerProgress {
  stage: string;      // Current stage name (e.g. "识别产品模块")
  round: number;       // Completed rounds (0-4)
  totalRounds: number; // Always 4
  message: string;     // Human-readable status message
}
