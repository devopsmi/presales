"use client";

import { useEffect, useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import type { FileTab } from "@/lib/types";

interface PdfPreviewProps {
  tab: FileTab;
}

export function PdfPreview({ tab }: PdfPreviewProps) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [blobUrl, setBlobUrl] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    try {
      const url = URL.createObjectURL(tab.file);
      setBlobUrl(url);
      setStatus("ready");
      return () => URL.revokeObjectURL(url);
    } catch (e: any) {
      setStatus("error");
      setErrorMsg(e?.message ?? "无法创建文件预览");
    }
  }, [tab.file]);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
        <Loader2 className="size-5 animate-spin" />
        <span className="text-sm">正在加载 PDF...</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 p-8">
        <AlertTriangle className="size-10 text-destructive/60" />
        <p className="text-sm">PDF 加载失败</p>
        <p className="text-xs opacity-60">{errorMsg}</p>
      </div>
    );
  }

  return (
    <iframe
      src={blobUrl}
      className="w-full h-full border-0"
      title={tab.name}
    />
  );
}
