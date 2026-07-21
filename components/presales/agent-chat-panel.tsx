"use client";

import { useEffect, useMemo, useCallback, useRef } from "react";
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
import { usePresales } from "@/lib/presales-context";
import { serializeFiles } from "@/lib/file-utils";
import type { QuotationRow, QuotationHeader } from "@/lib/types";
import type { TradeRole } from "@/lib/constants";

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
    setAttachments,
    setQuotationResult,
    setQuotationTrades,
    setQuotation,
    setHeader,
    syncConfig,
  } = usePresales();

  const filesRef = useRef<File[]>([]);
  useEffect(() => {
    filesRef.current = attachments;
  }, [attachments]);

  // filesRef is read at fetch call time (async), not during render — the refs lint is a false positive here
  // eslint-disable-next-line react-hooks/refs
  const transport = new DefaultChatTransport({
    body: { sessionId },
    async fetch(url, init) {
      if (init?.body) {
        const bodyObj = JSON.parse(init.body as string);
        const files = await serializeFiles(filesRef.current);
        if (files.length > 0) {
          bodyObj.files = files;
          init.body = JSON.stringify(bodyObj);
        }
        filesRef.current = [];
      }
      return fetch(url, init);
    },
  });

  const { messages, status, sendMessage, stop } = useChat({
    transport,
    onFinish: (options) => {
      const q = extractQuotationFromMessages([options.message]);
      if (q) {
        setQuotationResult(q.header, q.rows, q.trades);
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
    const q = extractQuotationFromMessages(
      messages as Array<{ content?: string; parts?: Array<{ type: string; text?: string }> }>,
    );
    if (q) {
      setQuotationResult(q.header, q.rows, q.trades);
    }
  }, [messages, setQuotationResult]);

  useEffect(() => {
    if (status === "ready" && messages.length === 0) {
      setQuotation(null);
      setHeader(null);
      setQuotationTrades(null);
    }
  }, [status, messages.length, setQuotation, setHeader, setQuotationTrades]);

  async function handleSend(message: { role: "user"; content: string }) {
    await syncConfig();
    sendMessage({ text: message.content });
    setAttachments([]);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 overflow-scroll scrollbar-none">
        <MessageList messages={messages} status={status} />
      </div>
      <InputBar
        className="[&_.max-w-an]:max-w-none"
        onSend={handleSend}
        status={status}
        onStop={stop}
        placeholder="请输入您的产品需求..."
        attachedFiles={attachedFiles}
        onRemoveFile={handleRemoveFile}
        leftActions={
          <div className="flex items-center gap-1 flex-wrap">
            <FileUploadMenu />
            <TradeSelector />
            <BudgetInput />
            <VendorNameInput />
            <ModelPicker />
          </div>
        }
      />
    </div>
  );
}
