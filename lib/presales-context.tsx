"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import type { TradeRole, Industry } from "@/lib/constants";
import { DEFAULT_MODEL, DEFAULT_INDUSTRY, INDUSTRY_DEFAULTS, VENDOR_NAME, TRADE_DAILY_RATES } from "@/lib/constants";
import type { QuotationRow, QuotationHeader, QuotedRates, FileTab } from "@/lib/types";
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
  config: { trades: TradeRole[]; budgetRange: [number, number]; model: string; models: ModelConfig[]; vendorName: string; estimationPlanId: string; quotedRates: QuotedRates; promptOverrides: Record<string, string> },
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
        estimationPlanId: config.estimationPlanId,
        quotedRates: config.quotedRates,
        promptOverrides: config.promptOverrides,
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
  uploadError: string | null;
  quotation: QuotationRow[] | null;
  header: QuotationHeader | null;
  sessionId: string;
  quotationTrades: TradeRole[] | null;
  vendorName: string;
  estimationPlanId: string;
  quotedRates: QuotedRates;
  fileTabs: FileTab[];
  activeRightTab: string;
  promptOverrides: Record<string, string>;
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
  uploadError: string | null;
  setUploadError: (error: string | null) => void;
  setQuotation: (rows: QuotationRow[] | null) => void;
  setHeader: (header: QuotationHeader | null) => void;
  setQuotationTrades: (trades: TradeRole[] | null) => void;
  setQuotationResult: (header: QuotationHeader, rows: QuotationRow[], trades: TradeRole[]) => void;
  setVendorName: (name: string) => void;
  setEstimationPlanId: (planId: string) => void;
  setQuotedRates: (rates: QuotedRates) => void;
  syncConfig: () => Promise<void>;
  reset: () => Promise<void>;
  setActiveRightTab: (tabId: string) => void;
  closeFileTab: (tabId: string) => void;
  setFileParsedContent: (fileName: string, parsed: string) => void;
  setPromptOverrides: (overrides: Record<string, string>) => void;
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
        estimationPlanId: parsed.estimationPlanId ?? undefined,
        quotedRates: parsed.quotedRates ?? undefined,
        promptOverrides: parsed.promptOverrides ?? undefined,
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
      estimationPlanId: state.estimationPlanId,
      quotedRates: state.quotedRates,
      promptOverrides: state.promptOverrides,
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
  uploadError: null,
  quotation: null,
  header: null,
  sessionId: "",
  quotationTrades: null,
  vendorName: VENDOR_NAME,
  estimationPlanId: "expert-judgment-plan",
  quotedRates: { ...TRADE_DAILY_RATES },
  fileTabs: [],
  activeRightTab: "quotation",
  promptOverrides: {},
};

export function PresalesProvider({ children }: { children: ReactNode }) {
  const prefs = typeof window !== "undefined" ? loadPreferences() : {};

  const [sessionId, setSessionId] = useState<string>(loadSessionId);
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
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [quotation, setQuotation] = useState<QuotationRow[] | null>(defaults.quotation);
  const [header, setHeader] = useState<QuotationHeader | null>(defaults.header);
  const [quotationTrades, setQuotationTrades] = useState<TradeRole[] | null>(defaults.quotationTrades);
  const [vendorName, setVendorName] = useState<string>(
    prefs.vendorName ?? defaults.vendorName
  );
  const [estimationPlanId, setEstimationPlanId] = useState<string>(
    prefs.estimationPlanId ?? defaults.estimationPlanId
  );
  const [quotedRates, setQuotedRates] = useState<QuotedRates>(
    prefs.quotedRates ?? defaults.quotedRates
  );
  const [promptOverrides, setPromptOverridesRaw] = useState<Record<string, string>>(
    prefs.promptOverrides ?? defaults.promptOverrides
  );
  const [fileTabs, setFileTabs] = useState<FileTab[]>(defaults.fileTabs);
  const [activeRightTab, setActiveRightTab] = useState<string>(defaults.activeRightTab);

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
    const newTabs: FileTab[] = files.map((f) => ({
      id: `file-${crypto.randomUUID()}`,
      name: f.name,
      size: f.size,
      file: f,
    }));
    setFileTabs((prev) => [...prev, ...newTabs]);
    if (newTabs.length > 0) {
      setActiveRightTab(newTabs[0].id);
    }
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const closeFileTab = useCallback((tabId: string) => {
    setFileTabs((prev) => prev.filter((t) => t.id !== tabId));
    setActiveRightTab((prev) => (prev === tabId ? "quotation" : prev));
  }, []);

  const setPromptOverrides = useCallback((overrides: Record<string, string>) => {
    setPromptOverridesRaw(overrides);
  }, []);

  const setFileParsedContent = useCallback((fileName: string, parsed: string) => {
    setFileTabs((prev) =>
      prev.map((t) => (t.name === fileName ? { ...t, parsed } : t)),
    );
  }, []);

  const reset = useCallback(async () => {
    const oldSessionId = sessionId;
    const newSessionId = generateSessionId();
    try {
      localStorage.setItem(SESSION_ID_KEY, newSessionId);
    } catch {
      // Ignore
    }
    // Clear backend cache for old session (fire-and-forget)
    fetch("/api/session/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: oldSessionId }),
    }).catch(() => { });
    setSessionId(newSessionId);
    setAttachments(defaults.attachments);
    setQuotation(defaults.quotation);
    setHeader(defaults.header);
    setQuotationTrades(defaults.quotationTrades);
    setFileTabs(defaults.fileTabs);
    setActiveRightTab(defaults.activeRightTab);
  }, [sessionId]);

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
      estimationPlanId,
      quotedRates,
      promptOverrides,
    });
  }, [sessionId, selectedTrades, budgetRange, modelProvider, customModels, vendorName, estimationPlanId, quotedRates, promptOverrides]);

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
      estimationPlanId,
      quotedRates,
      promptOverrides,
    });
  }, [sessionId, selectedTrades, budgetRange, modelProvider, customModels, vendorName, estimationPlanId, quotedRates, promptOverrides]);

  // Persist preferences on change
  const currentState: PresalesState = {
    selectedTrades, industry, budgetRange, modelProvider, customModels,
    attachments, quotation, header, sessionId, quotationTrades, vendorName,
    estimationPlanId, quotedRates, uploadError, fileTabs, activeRightTab, promptOverrides,
  };

  useEffect(() => {
    savePreferences(currentState);
  }, [selectedTrades, industry, budgetRange, modelProvider, customModels, estimationPlanId, quotedRates, promptOverrides]);

  const value: PresalesContextValue = {
    selectedTrades, industry, budgetRange, modelProvider, customModels, attachments,
    quotation, header, sessionId, quotationTrades, vendorName, estimationPlanId, quotedRates,
    fileTabs, activeRightTab, promptOverrides,
    setSelectedTrades, setIndustry, setBudgetRange, setModelProvider, setCustomModels,
    setAttachments, addAttachments, removeAttachment, uploadError, setUploadError,
    setQuotation, setHeader, setQuotationTrades, setQuotationResult, setVendorName, setEstimationPlanId, setQuotedRates, syncConfig, reset,
    setActiveRightTab, closeFileTab, setFileParsedContent, setPromptOverrides,
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
