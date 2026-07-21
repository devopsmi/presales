import type { TradeRole } from "@/lib/constants";
import { DEFAULT_MODEL, VENDOR_NAME } from "@/lib/constants";

export interface ModelConfig {
  id: string;
  name: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  /** Protocol to use for this model's API calls */
  protocol: "openai" | "anthropic";
}

export interface SessionConfig {
  trades: TradeRole[];
  budgetRange: [number, number];
  model: string;
  models: ModelConfig[];
  vendorName: string;
}

const DEFAULT_CONFIG: SessionConfig = {
  trades: ["frontend", "backend"],
  budgetRange: [0, 2000000],
  model: DEFAULT_MODEL,
  models: [],
  vendorName: VENDOR_NAME,
};

const store = new Map<string, SessionConfig>();

export function getSessionConfig(sessionId: string): SessionConfig {
  return store.get(sessionId) ?? { ...DEFAULT_CONFIG, models: [], vendorName: VENDOR_NAME };
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
  };
  store.set(sessionId, updated);
  return updated;
}
