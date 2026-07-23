"use client";

import { useEffect, useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import type { FileTab } from "@/lib/types";

interface XlsxPreviewProps {
  tab: FileTab;
}

interface SheetInfo {
  name: string;
  html: string;
}

export function XlsxPreview({ tab }: XlsxPreviewProps) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadXlsx() {
      try {
        setStatus("loading");
        const XLSX = await import("xlsx");
        const arrayBuffer = await tab.file.arrayBuffer();
        const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });

        if (cancelled) return;

        const parsedSheets: SheetInfo[] = workbook.SheetNames.map((name) => {
          const sheet = workbook.Sheets[name];
          const htmlStr = XLSX.utils.sheet_to_html(sheet, { id: `xlsx-sheet-${name}` });
          return { name, html: htmlStr };
        });

        if (parsedSheets.length === 0) {
          setStatus("error");
          setErrorMsg("工作簿中没有工作表");
          return;
        }

        setSheets(parsedSheets);
        setStatus("ready");
      } catch (e: any) {
        if (cancelled) return;
        setStatus("error");
        setErrorMsg(e?.message ?? "无法加载 Excel 文件");
      }
    }

    loadXlsx();
    return () => { cancelled = true; };
  }, [tab.file]);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
        <Loader2 className="size-5 animate-spin" />
        <span className="text-sm">正在解析 Excel 表格...</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 p-8">
        <AlertTriangle className="size-10 text-destructive/60" />
        <p className="text-sm">表格加载失败</p>
        <p className="text-xs opacity-60">{errorMsg}</p>
      </div>
    );
  }

  const currentSheet = sheets[activeSheet];

  return (
    <div className="flex flex-col h-full">
      {sheets.length > 1 && (
        <div className="flex items-center gap-0 px-1 py-1 bg-muted/50 border-b shrink-0 overflow-x-auto scrollbar-none">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              onClick={() => setActiveSheet(i)}
              className={`shrink-0 px-3 py-1 text-xs rounded-t-sm transition-colors ${
                i === activeSheet
                  ? "bg-background text-foreground font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-auto">
        <div
          className="xlsx-preview text-xs"
          dangerouslySetInnerHTML={{ __html: currentSheet.html }}
        />
      </div>
    </div>
  );
}
