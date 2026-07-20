"use client";

import { useEffect, useMemo, useCallback } from "react";
import { useChat } from "@ai-sdk/react";
import { MessageList } from "@/components/agent-elements/message-list";
import { InputBar } from "@/components/agent-elements/input-bar";
import type { AttachedFile } from "@/components/agent-elements/input-bar";
import { FileUploadMenu } from "./file-upload-menu";
import { TradeSelector } from "./trade-selector";
import { BudgetSlider } from "./budget-slider";
import { ModelPicker } from "./model-picker";
import { usePresales } from "@/lib/presales-context";
import type { QuotationRow, QuotationHeader } from "@/lib/agent/state";

function extractQuotationFromText(text: string): { header: QuotationHeader; rows: QuotationRow[] } | null {
  const startIdx = text.indexOf("__QUOTATION__");
  if (startIdx === -1) return null;
  const endIdx = text.indexOf("__END_QUOTATION__", startIdx + 13);
  if (endIdx === -1) return null;
  try {
    const data = JSON.parse(text.slice(startIdx + 13, endIdx));
    if (data.header && Array.isArray(data.rows)) return data;
  } catch { }
  return null;
}

function extractQuotationFromMessages(
  messages: Array<{ content?: string; parts?: Array<{ type: string; text?: string }> }>,
): { header: QuotationHeader; rows: QuotationRow[] } | null {
  for (const msg of [...messages].reverse()) {
    for (const part of msg.parts ?? []) {
      if (part.type === "text" && part.text) {
        const q = extractQuotationFromText(part.text);
        if (q) return q;
      }
    }
    if (msg.content) {
      const q = extractQuotationFromText(msg.content);
      if (q) return q;
    }
  }
  return null;
}

export function AgentChatPanel() {
  const {
    selectedTrades,
    budgetRange,
    modelProvider,
    attachments,
    removeAttachment,
    setQuotation,
    setHeader,
  } = usePresales();

  const { messages, status, sendMessage, stop } = useChat({
    onFinish: (options) => {
      const q = extractQuotationFromMessages([options.message]);
      if (q) {
        setHeader(q.header);
        setQuotation(q.rows);
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
      setHeader(q.header);
      setQuotation(q.rows);
    }
  }, [messages, setHeader, setQuotation]);

  useEffect(() => {
    if (status === "ready" && messages.length === 0) {
      setQuotation(null);
      setHeader(null);
    }
  }, [status, messages.length, setQuotation, setHeader]);

  function handleSend(message: { role: "user"; content: string }) {
    const configMeta = JSON.stringify({
      trades: selectedTrades,
      budgetRange,
      model: modelProvider,
    });
    const fullText = `__PRESALES_CONFIG__${configMeta}__END_CONFIG__\n${message.content}`;
    sendMessage({ text: fullText });
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
            <BudgetSlider />
            <ModelPicker />
          </div>
        }
      />
    </div>
  );
}
