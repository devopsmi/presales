"use client";

import { useEffect, useMemo, useCallback, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { MessageList } from "@/components/agent-elements/message-list";
import { InputBar } from "@/components/agent-elements/input-bar";
import type { AttachedFile } from "@/components/agent-elements/input-bar";
import { FileUploadMenu } from "./file-upload-menu";
import { TradeSelector } from "./trade-selector";
import { BudgetInput } from "./budget-input";
import { ModelPicker } from "./model-picker";
import { VendorNameInput } from "./vendor-name-input";
import { EstimationPlanPicker } from "./estimation-plan-picker";
import { DecomposerProgressCard } from "./decomposer-progress-card";
import { FileParserCard, GrillMeCard, EstimatorCard } from "./presales-tool-cards";
import { usePresales } from "@/lib/presales-context";
import { serializeFiles } from "@/lib/file-utils";
import type { QuotationRow, QuotationHeader } from "@/lib/types";
import type { TradeRole } from "@/lib/constants";

interface QuotationExtract {
  header: QuotationHeader;
  rows: QuotationRow[];
  trades: TradeRole[];
}

interface ParsedFileEntry {
  name: string;
  type: string;
  parsed: string;
}

function extractFileParserOutput(
  part: { type: string; state?: string; output?: unknown },
): ParsedFileEntry[] | null {
  const isParserTool =
    part.type === "tool-subagent_file_parser" || part.type === "tool-pipeline_parser";
  if (!isParserTool || part.state !== "output-available") {
    return null;
  }
  try {
    const output = typeof part.output === "string" ? JSON.parse(part.output) : part.output;
    if (output && Array.isArray((output as any).parsedFiles)) {
      return (output as any).parsedFiles as ParsedFileEntry[];
    }
  } catch {}
  return null;
}

function extractFileParserFromMessages(
  messages: Array<{ parts?: Array<{ type: string; state?: string; output?: unknown }> }>,
): ParsedFileEntry[] | null {
  for (const msg of [...messages].reverse()) {
    for (const part of msg.parts ?? []) {
      const files = extractFileParserOutput(part);
      if (files) return files;
    }
  }
  return null;
}

interface QuotationExtract {
  header: QuotationHeader;
  rows: QuotationRow[];
  trades: TradeRole[];
}

function extractQuotationFromToolPart(
  part: { type: string; state?: string; output?: unknown },
): QuotationExtract | null {
  // Check both new (subagent_estimator) and legacy (pipeline_quoter) tool names
  const isQuotationTool =
    (part.type === "tool-subagent_estimator" || part.type === "tool-pipeline_quoter");
  if (!isQuotationTool || part.state !== "output-available") {
    return null;
  }
  try {
    const output = typeof part.output === "string" ? JSON.parse(part.output) : part.output;
    if (output && typeof output === "object" && "header" in output && Array.isArray((output as any).rows)) {
      const data = output as { header: QuotationHeader; rows: QuotationRow[]; trades?: TradeRole[] };
      const trades: TradeRole[] = Array.isArray(data.trades) && data.trades.length > 0
        ? data.trades
        : deriveTradesFromRows(data.rows);
      return { header: data.header, rows: data.rows, trades };
    }
  } catch {}
  return null;
}

function deriveTradesFromRows(rows: QuotationRow[]): TradeRole[] {
  const keys = new Set<TradeRole>();
  for (const row of rows) {
    for (const key of Object.keys(row.trades) as TradeRole[]) {
      keys.add(key);
    }
  }
  return Array.from(keys);
}

function extractQuotationFromMessages(
  messages: Array<{ parts?: Array<{ type: string; state?: string; output?: unknown }> }>,
): QuotationExtract | null {
  for (const msg of [...messages].reverse()) {
    for (const part of msg.parts ?? []) {
      const q = extractQuotationFromToolPart(part);
      if (q) return q;
    }
  }
  return null;
}

export function AgentChatPanel() {
  const {
    sessionId,
    attachments,
    removeAttachment,
    addAttachments,
    setAttachments,
    uploadError, setUploadError,
    setQuotationResult,
    setQuotationTrades,
    setQuotation,
    setHeader,
    syncConfig,
    setFileParsedContent,
  } = usePresales();

  const filesRef = useRef<File[]>([]);
  useEffect(() => {
    filesRef.current = attachments;
  }, [attachments]);

  const [isDragOver, setIsDragOver] = useState(false);

  // Guards: prevent repeated JSON.parse + message scanning on every SSE delta.
  // Reset when a new user message is sent (handleSend).
  const quotationExtractedRef = useRef(false);
  const fileParserExtractedRef = useRef(false);

  function handleFilesFromDrop(files: File[]) {
    const valid: File[] = [];
    const rejected: string[] = [];
    for (const f of files) {
      if (f.size > 10 * 1024 * 1024) {
        rejected.push(`${f.name} (${(f.size / 1024 / 1024).toFixed(1)}MB > 10MB)`);
        continue;
      }
      valid.push(f);
    }
    if (valid.length > 0) addAttachments(valid);
    if (rejected.length > 0) {
      setUploadError(`以下文件超过 10MB 限制: ${rejected.join(", ")}`);
    }
  }

  // filesRef is read at fetch call time (async), not during render — the refs lint is a false positive here
  // eslint-disable-next-line react-hooks/refs
  const transport = new DefaultChatTransport({
    body: { sessionId },
    async fetch(url, init) {
      if (init?.body) {
        const bodyObj = JSON.parse(init.body as string);
        const { files, errors } = await serializeFiles(filesRef.current);
        if (errors.length > 0) {
          setUploadError(`文件处理失败: ${errors.map(e => `${e.name}: ${e.error}`).join("; ")}`);
        }
        if (files.length > 0) {
          bodyObj.files = files;
          init.body = JSON.stringify(bodyObj);
        }
        // Only remove files that were serialized, preserving any
        // files added concurrently during the async operation.
        const snapshotLen = filesRef.current.length;
        filesRef.current = filesRef.current.slice(snapshotLen);
        // Sync React state with ref to clear file chips from UI
        setAttachments(filesRef.current);
      }
      return fetch(url, init);
    },
  });

  const { messages, status, sendMessage, stop } = useChat({
    transport,
    onFinish: (options) => {
      if (!quotationExtractedRef.current) {
        const q = extractQuotationFromMessages([options.message]);
        if (q) {
          quotationExtractedRef.current = true;
          setQuotationResult(q.header, q.rows, q.trades);
        }
      }
      if (!fileParserExtractedRef.current) {
        const parsedFiles = extractFileParserFromMessages([options.message]);
        if (parsedFiles) {
          fileParserExtractedRef.current = true;
          for (const f of parsedFiles) {
            setFileParsedContent(f.name, f.parsed);
          }
        }
      }
    },
  });

  const attachedFiles: AttachedFile[] = useMemo(
    () =>
      attachments.map((f, i) => ({
        id: `attach-${i}`,
        filename: f.name,
        size: f.size,
      })),
    [attachments],
  );

  const handleRemoveFile = useCallback(
    (id: string) => {
      const idx = parseInt(id.replace("attach-", ""), 10);
      if (!isNaN(idx) && idx >= 0 && idx < attachments.length) {
        removeAttachment(idx);
      }
    },
    [attachments.length, removeAttachment],
  );

  useEffect(() => {
    if (fileParserExtractedRef.current) return;
    const parsedFiles = extractFileParserFromMessages(
      messages as Array<{ content?: string; parts?: Array<{ type: string; text?: string }> }>,
    );
    if (parsedFiles) {
      fileParserExtractedRef.current = true;
      for (const f of parsedFiles) {
        setFileParsedContent(f.name, f.parsed);
      }
    }
  }, [messages, setFileParsedContent]);

  useEffect(() => {
    if (status === "ready" && messages.length === 0) {
      setQuotation(null);
      setHeader(null);
      setQuotationTrades(null);
    }
  }, [status, messages.length, setQuotation, setHeader, setQuotationTrades]);

  async function handleSend(message: { role: "user"; content: string }) {
    quotationExtractedRef.current = false;
    fileParserExtractedRef.current = false;
    await syncConfig();
    sendMessage({ text: message.content });
    // Attachments cleared by transport.fetch after serialization,
    // NOT here — clearing here races with the async fetch.
  }

  return (
    <div
      className="flex flex-col h-full"
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={(e) => {
        // Only set false when leaving the container, not child elements
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsDragOver(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        if (e.dataTransfer?.files) {
          handleFilesFromDrop(Array.from(e.dataTransfer.files));
        }
      }}
    >
      <div className="flex-1 min-h-0 overflow-scroll scrollbar-none">
        <MessageList
          messages={messages}
          status={status}
          toolRenderers={{
            subagent_decomposer: DecomposerProgressCard,
            subagent_file_parser: FileParserCard,
            grill_me: GrillMeCard,
            subagent_estimator: EstimatorCard,
          }}
        />
      </div>
      <InputBar
        className="[&_.max-w-an]:max-w-none"
        onSend={handleSend}
        status={status}
        onStop={stop}
        placeholder="请输入您的产品需求..."
        attachedFiles={attachedFiles}
        onRemoveFile={handleRemoveFile}
        isDragOver={isDragOver}
        onPaste={(e) => {
          const items = e.clipboardData?.items;
          if (!items) return;
          const files: File[] = [];
          for (const item of Array.from(items)) {
            const file = item.getAsFile();
            if (file) files.push(file);
          }
          if (files.length > 0) {
            e.preventDefault();
            handleFilesFromDrop(files);
          }
        }}
        leftActions={
          <div className="flex items-center gap-1 flex-wrap">
            <FileUploadMenu />
            <TradeSelector />
            <BudgetInput />
            <VendorNameInput />
            <ModelPicker />
            <EstimationPlanPicker />
          </div>
        }
      />
    </div>
  );
}
