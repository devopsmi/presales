"use client";

import type { QuotationHeader as QuotationHeaderType } from "@/lib/agent/state";
import type { TradeRole } from "@/lib/constants";
import { TRADE_LABELS } from "@/lib/constants";

interface QuotationHeaderProps {
  header: QuotationHeaderType;
  trades: TradeRole[];
}

export function QuotationHeader({ header, trades }: QuotationHeaderProps) {
  const tradeList = trades.map((t) => TRADE_LABELS[t]).join(" | ");

  return (
    <div className="space-y-1.5 p-4 border-b bg-muted/20">
      <div className="text-sm">
        <span className="text-muted-foreground">客户名称：</span>
        <span className="font-medium">{header.customerName}</span>
      </div>
      <div className="text-sm">
        <span className="text-muted-foreground">项目名称：</span>
        <span className="font-medium">{header.projectName}</span>
      </div>
      <div className="text-sm">
        <span className="text-muted-foreground">报价时间：</span>
        <span>{header.quoteDate}</span>
      </div>
      <div className="text-sm">
        <span className="text-muted-foreground">报价单位：</span>
        <span>{header.vendorName}</span>
      </div>
      <div className="text-sm text-muted-foreground">
        参与工种：{tradeList}
      </div>
    </div>
  );
}
