"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import type { TradeRole, Industry } from "@/lib/constants";
import { DEFAULT_MODEL, DEFAULT_INDUSTRY, INDUSTRY_DEFAULTS, VENDOR_NAME } from "@/lib/constants";
import type { QuotationRow, QuotationHeader } from "@/lib/types";
import type { ModelConfig } from "@/lib/session-config";

function generateSessionId(): string {
  return "ses-" + crypto.randomUUID();
}

const SESSION_ID_KEY = "presales-session-id";

function loadSessionId(): string {
  if (typeof window === "undefined") return generateSessionId();
  try {
    const stored = localStorage.getItem(SESSION_ID_KEY);
    if (stored) return stored;
  } catch {
    // Ignore
  }
  const id = generateSessionId();
  try {
    localStorage.setItem(SESSION_ID_KEY, id);
  } catch {
    // Ignore
  }
  return id;
}

async function syncConfigToBackend(
  sessionId: string,
  config: { trades: TradeRole[]; budgetRange: [number, number]; model: string; models: ModelConfig[]; vendorName: string },
): Promise<void> {
  try {
    await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        trades: config.trades,
        budgetRange: config.budgetRange,
        model: config.model,
        models: config.models,
        vendorName: config.vendorName,
      }),
    });
  } catch {
    // Non-blocking — config will be re-synced on next chat send
  }
}

interface PresalesState {
  selectedTrades: TradeRole[];
  industry: Industry;
  budgetRange: [number, number];
  modelProvider: string;
  customModels: ModelConfig[];
  attachments: File[];
  quotation: QuotationRow[] | null;
  header: QuotationHeader | null;
  sessionId: string;
  quotationTrades: TradeRole[] | null;
  vendorName: string;
}

interface PresalesContextValue extends PresalesState {
  setSelectedTrades: (trades: TradeRole[]) => void;
  setIndustry: (industry: Industry) => void;
  setBudgetRange: (range: [number, number]) => void;
  setModelProvider: (model: string) => void;
  setCustomModels: (models: ModelConfig[]) => void;
  setAttachments: (files: File[]) => void;
  addAttachments: (files: File[]) => void;
  removeAttachment: (index: number) => void;
  setQuotation: (rows: QuotationRow[] | null) => void;
  setHeader: (header: QuotationHeader | null) => void;
  setQuotationTrades: (trades: TradeRole[] | null) => void;
  setQuotationResult: (header: QuotationHeader, rows: QuotationRow[], trades: TradeRole[]) => void;
  setVendorName: (name: string) => void;
  syncConfig: () => Promise<void>;
  reset: () => void;
}

const STORAGE_KEY = "presales-preferences";

const PresalesContext = createContext<PresalesContextValue | null>(null);

function loadPreferences(): Partial<PresalesState> {
  if (typeof window === "undefined") return {};
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        selectedTrades: parsed.selectedTrades ?? undefined,
        industry: parsed.industry ?? undefined,
        budgetRange: parsed.budgetRange ?? undefined,
        modelProvider: parsed.modelProvider ?? undefined,
        customModels: parsed.customModels ?? undefined,
        vendorName: parsed.vendorName ?? undefined,
      };
    }
  } catch {
    // Ignore parse errors
  }
  return {};
}

function savePreferences(state: PresalesState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      selectedTrades: state.selectedTrades,
      industry: state.industry,
      budgetRange: state.budgetRange,
      modelProvider: state.modelProvider,
      customModels: state.customModels,
      vendorName: state.vendorName,
    }));
  } catch {
    // Ignore quota errors
  }
}

const defaults: PresalesState = {
  selectedTrades: INDUSTRY_DEFAULTS[DEFAULT_INDUSTRY],
  industry: DEFAULT_INDUSTRY,
  budgetRange: [0, 2000000],
  modelProvider: DEFAULT_MODEL,
  customModels: [],
  attachments: [],
  quotation: null,
  header: null,
  sessionId: "",
  quotationTrades: null,
  vendorName: VENDOR_NAME,
};

export function PresalesProvider({ children }: { children: ReactNode }) {
  const prefs = typeof window !== "undefined" ? loadPreferences() : {};

  const [sessionId] = useState<string>(loadSessionId);
  const [selectedTrades, setSelectedTradesRaw] = useState<TradeRole[]>(
    prefs.selectedTrades ?? defaults.selectedTrades
  );
  const [industry, setIndustryRaw] = useState<Industry>(
    prefs.industry ?? defaults.industry
  );
  const [budgetRange, setBudgetRange] = useState<[number, number]>(
    prefs.budgetRange ?? defaults.budgetRange
  );
  const [modelProvider, setModelProviderRaw] = useState<string>(
    prefs.modelProvider ?? defaults.modelProvider
  );
  const [customModels, setCustomModels] = useState<ModelConfig[]>(
    prefs.customModels ?? defaults.customModels
  );
  const [attachments, setAttachments] = useState<File[]>(defaults.attachments);
  const [quotation, setQuotation] = useState<QuotationRow[] | null>(defaults.quotation);
  const [header, setHeader] = useState<QuotationHeader | null>(defaults.header);
  const [quotationTrades, setQuotationTrades] = useState<TradeRole[] | null>(defaults.quotationTrades);
  const [vendorName, setVendorName] = useState<string>(
    prefs.vendorName ?? defaults.vendorName
  );

  // Avoid syncing on initial mount — only sync on subsequent changes
  const mountedRef = useRef(false);

  // When industry changes, update selected trades to industry defaults
  const setIndustry = useCallback((ind: Industry) => {
    setIndustryRaw(ind);
    setSelectedTradesRaw(INDUSTRY_DEFAULTS[ind]);
  }, []);

  const setSelectedTrades = useCallback((trades: TradeRole[]) => {
    setSelectedTradesRaw(trades);
  }, []);

  const setModelProvider = useCallback((model: string) => {
    setModelProviderRaw(model);
  }, []);

  const addAttachments = useCallback((files: File[]) => {
    setAttachments((prev) => [...prev, ...files]);
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const reset = useCallback(() => {
    setSelectedTradesRaw(defaults.selectedTrades);
    setIndustryRaw(defaults.industry);
    setBudgetRange(defaults.budgetRange);
    setModelProviderRaw(defaults.modelProvider);
    setCustomModels(defaults.customModels);
    setAttachments(defaults.attachments);
    setQuotation(defaults.quotation);
    setHeader(defaults.header);
    setQuotationTrades(defaults.quotationTrades);
    setVendorName(defaults.vendorName);
  }, []);

  const setQuotationResult = useCallback(
    (h: QuotationHeader, rows: QuotationRow[], trades: TradeRole[]) => {
      setHeader(h);
      setQuotation(rows);
      setQuotationTrades(trades);
    },
    [],
  );

  const syncConfig = useCallback(async () => {
    await syncConfigToBackend(sessionId, {
      trades: selectedTrades,
      budgetRange,
      model: modelProvider,
      models: customModels,
      vendorName,
    });
  }, [sessionId, selectedTrades, budgetRange, modelProvider, customModels, vendorName]);

  // Sync config to backend on changes (skip initial mount)
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    syncConfigToBackend(sessionId, {
      trades: selectedTrades,
      budgetRange,
      model: modelProvider,
      models: customModels,
      vendorName,
    });
  }, [sessionId, selectedTrades, budgetRange, modelProvider, customModels, vendorName]);

  // Persist preferences on change
  const currentState: PresalesState = {
    selectedTrades, industry, budgetRange, modelProvider, customModels,
    attachments, quotation, header, sessionId, quotationTrades, vendorName,
  };

  useEffect(() => {
    savePreferences(currentState);
  }, [selectedTrades, industry, budgetRange, modelProvider, customModels]);

  const value: PresalesContextValue = {
    selectedTrades, industry, budgetRange, modelProvider, customModels, attachments,
    quotation, header, sessionId, quotationTrades, vendorName,
    setSelectedTrades, setIndustry, setBudgetRange, setModelProvider, setCustomModels,
    setAttachments, addAttachments, removeAttachment,
    setQuotation, setHeader, setQuotationTrades, setQuotationResult, setVendorName, syncConfig, reset,
  };

  return (
    <PresalesContext.Provider value={value}>{children}</PresalesContext.Provider>
  );
}

export function usePresales(): PresalesContextValue {
  const ctx = useContext(PresalesContext);
  if (!ctx) {
    throw new Error("usePresales must be used within PresalesProvider");
  }
  return ctx;
}
