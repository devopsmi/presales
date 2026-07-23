"use client";

import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { QuotationRow, QuotationHeader, QuotedRates } from "@/lib/types";
import type { TradeRole } from "@/lib/constants";
import { useState } from "react";
import log from "@/lib/logger";

interface ExportButtonsProps {
  rows: QuotationRow[];
  header: QuotationHeader;
  trades: TradeRole[];
  quotedRates?: QuotedRates;
}

export function ExportButtons({ rows, header, trades, quotedRates }: ExportButtonsProps) {
  const [downloading, setDownloading] = useState(false);

  async function handleDownloadXlsx() {
    setDownloading(true);
    try {
      const res = await fetch("/api/quotation/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, header, trades, quotedRates }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `报价单_${header.projectName}_${header.quoteDate}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      log.error("Export failed", {error: err instanceof Error ? err : new Error(String(err))});
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex items-center gap-2 p-3 border-b">
      <Button size="sm" onClick={handleDownloadXlsx} disabled={downloading}>
        <FileSpreadsheet className="size-4 mr-1.5" />
        {downloading ? "生成中..." : "下载报价单 (.xlsx)"}
      </Button>
      <Tooltip>
        <TooltipTrigger>
          <Button size="sm" variant="outline" disabled>
            <FileText className="size-4 mr-1.5" />
            导出 PDF
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>v1 即将支持</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
