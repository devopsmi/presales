"use client";

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import type { TradeRole, Industry } from "@/lib/constants";
import { DEFAULT_MODEL, DEFAULT_INDUSTRY, INDUSTRY_DEFAULTS, VENDOR_NAME } from "@/lib/constants";
import type { QuotationRow, QuotationHeader } from "@/lib/agent/state";

interface PresalesState {
  selectedTrades: TradeRole[];
  industry: Industry;
  budgetRange: [number, number];
  modelProvider: string;
  attachments: File[];
  quotation: QuotationRow[] | null;
  header: QuotationHeader | null;
}

interface PresalesContextValue extends PresalesState {
  setSelectedTrades: (trades: TradeRole[]) => void;
  setIndustry: (industry: Industry) => void;
  setBudgetRange: (range: [number, number]) => void;
  setModelProvider: (model: string) => void;
  setAttachments: (files: File[]) => void;
  addAttachments: (files: File[]) => void;
  removeAttachment: (index: number) => void;
  setQuotation: (rows: QuotationRow[] | null) => void;
  setHeader: (header: QuotationHeader | null) => void;
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
  attachments: [],
  quotation: null,
  header: null,
};

export function PresalesProvider({ children }: { children: ReactNode }) {
  const prefs = typeof window !== "undefined" ? loadPreferences() : {};

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
  const [attachments, setAttachments] = useState<File[]>(defaults.attachments);
  const [quotation, setQuotation] = useState<QuotationRow[] | null>(defaults.quotation);
  const [header, setHeader] = useState<QuotationHeader | null>(defaults.header);

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
    setAttachments(defaults.attachments);
    setQuotation(defaults.quotation);
    setHeader(defaults.header);
  }, []);

  // Persist preferences on change
  const currentState: PresalesState = {
    selectedTrades, industry, budgetRange, modelProvider,
    attachments, quotation, header,
  };

  useEffect(() => {
    savePreferences(currentState);
  }, [selectedTrades, industry, budgetRange, modelProvider]);

  const value: PresalesContextValue = {
    selectedTrades, industry, budgetRange, modelProvider, attachments,
    quotation, header,
    setSelectedTrades, setIndustry, setBudgetRange, setModelProvider,
    setAttachments, addAttachments, removeAttachment,
    setQuotation, setHeader, reset,
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
