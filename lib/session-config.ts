import type { TradeRole } from "@/lib/constants";
import type { QuotedRates } from "@/lib/types";
import { DEFAULT_MODEL, VENDOR_NAME, TRADE_DAILY_RATES } from "@/lib/constants";

export const DEFAULT_MAX_TOKENS = 32768;

export interface ModelConfig {
  id: string;
  name: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  /** Protocol to use for this model's API calls */
  protocol: "openai" | "anthropic";
  /** Max output tokens (reasoning + content share this budget).
   *  Default 32768 — deepseek-v4-pro defaults to 4096 which is insufficient
   *  for thinking mode, causing empty content with reasoning-only output. */
  maxTokens?: number;
}

export interface SessionConfig {
  trades: TradeRole[];
  budgetRange: [number, number];
  model: string;
  models: ModelConfig[];
  vendorName: string;
  estimationPlanId: string;
  quotedRates: QuotedRates;
  promptOverrides?: Record<string, string>;
}

function defaultRates(): QuotedRates {
  return { ...TRADE_DAILY_RATES };
}

const DEFAULT_CONFIG: SessionConfig = {
  trades: ["frontend", "backend"],
  budgetRange: [0, 2000000],
  model: DEFAULT_MODEL,
  models: [],
  vendorName: VENDOR_NAME,
  estimationPlanId: "expert-judgment-plan",
  quotedRates: defaultRates(),
  promptOverrides: {},
};

const MAX_SESSION_CONFIGS = 100;
const store = new Map<string, SessionConfig>();

export function getSessionConfig(sessionId: string): SessionConfig {
  return store.get(sessionId) ?? { ...DEFAULT_CONFIG, models: [], vendorName: VENDOR_NAME, quotedRates: { ...DEFAULT_CONFIG.quotedRates } };
}

export function updateSessionConfig(
  sessionId: string,
  patch: Partial<SessionConfig>,
): SessionConfig {
  const current = getSessionConfig(sessionId);
    const updated: SessionConfig = {
      trades: patch.trades ?? current.trades,
      budgetRange: patch.budgetRange ?? current.budgetRange,
      model: patch.model ?? current.model,
      models: patch.models ?? current.models,
      vendorName: patch.vendorName ?? current.vendorName,
      estimationPlanId: patch.estimationPlanId ?? current.estimationPlanId,
      quotedRates: patch.quotedRates ?? current.quotedRates,
      promptOverrides: patch.promptOverrides ?? current.promptOverrides,
    };
  if (store.size >= MAX_SESSION_CONFIGS && !store.has(sessionId)) {
    const oldest = store.keys().next().value!;
    store.delete(oldest);
  }
  store.set(sessionId, updated);
  return updated;
}

export function deleteSessionConfig(sessionId: string): boolean {
  return store.delete(sessionId);
}
