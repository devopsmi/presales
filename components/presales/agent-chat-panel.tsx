"use client";

import { useEffect, useRef, useMemo, useCallback } from "react";
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

function extractQuotation(messages: { parts?: Array<{ type: string; text?: string }> }[]): {
  header: QuotationHeader;
  rows: QuotationRow[];
} | null {
  for (const msg of [...messages].reverse()) {
    const parts = msg.parts ?? [];
    for (const part of parts) {
      if (part.type !== "text" || !part.text) continue;
      const startIdx = part.text.indexOf("__QUOTATION__");
      if (startIdx === -1) continue;
      const endIdx = part.text.indexOf("__END_QUOTATION__", startIdx + 14);
      if (endIdx === -1) continue;
      const jsonStr = part.text.slice(startIdx + 14, endIdx);
      try {
        const data = JSON.parse(jsonStr);
        if (data.header && Array.isArray(data.rows)) {
          return { header: data.header, rows: data.rows };
        }
      } catch {
        continue;
      }
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
  const prevMsgCount = useRef(0);

  const { messages, status, sendMessage, stop } = useChat();

  // Map File[] to AttachedFile[] with stable index-based ids
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

  // Extract quotation from streamed messages
  useEffect(() => {
    if (messages.length <= prevMsgCount.current) return;
    prevMsgCount.current = messages.length;

    const quotation = extractQuotation(messages as Array<{ parts?: Array<{ type: string; text?: string }> }>);
    if (quotation) {
      setHeader(quotation.header);
      setQuotation(quotation.rows);
    }
  }, [messages, setHeader, setQuotation]);

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
      <div className="flex-1 min-h-0">
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
