"use client";

import { QuotationHeader } from "./quotation-header";
import { QuotationTable } from "./quotation-table";
import { ExportButtons } from "./export-buttons";
import { usePresales } from "@/lib/presales-context";
import { FileText } from "lucide-react";

export function ResultPanel() {
  const { quotation, header, quotationTrades } = usePresales();

  if (!quotation || quotation.length === 0 || !header) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 p-8">
        <FileText className="size-12 opacity-30" />
        <p className="text-sm">提交需求后将在此展示报价结果</p>
        <p className="text-xs opacity-60">包含功能拆解清单与工时报价表</p>
      </div>
    );
  }

  const trades = quotationTrades ?? [];

  return (
    <div className="flex flex-col h-full">
      <QuotationHeader header={header} trades={trades} />
      <ExportButtons rows={quotation} header={header} trades={trades} />
      <div className="flex-1 overflow-auto p-0">
        <QuotationTable rows={quotation} trades={trades} />
      </div>
    </div>
  );
}
