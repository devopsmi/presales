"use client";

import { useEffect, useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import type { FileTab } from "@/lib/types";

interface DocxPreviewProps {
  tab: FileTab;
}

export function DocxPreview({ tab }: DocxPreviewProps) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [html, setHtml] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadDocx() {
      try {
        setStatus("loading");
        const mammoth = await import("mammoth");
        const arrayBuffer = await tab.file.arrayBuffer();
        const result = await mammoth.default.convertToHtml(
          { arrayBuffer },
          {
            convertImage: mammoth.default.images.imgElement((image: any) => {
              return image.read("base64").then((imgBuf: Buffer) => ({
                src: `data:${image.contentType};base64,${imgBuf}`,
              }));
            }),
          },
        );

        if (cancelled) return;

        if (result.value) {
          setHtml(result.value);
          setStatus("ready");
        } else {
          setStatus("error");
          setErrorMsg("文档内容为空");
        }

        if (result.messages.length > 0) {
          console.warn("Mammoth warnings:", result.messages);
        }
      } catch (e: any) {
        if (cancelled) return;
        setStatus("error");
        setErrorMsg(e?.message ?? "无法加载 DOCX 文件");
      }
    }

    loadDocx();
    return () => { cancelled = true; };
  }, [tab.file]);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
        <Loader2 className="size-5 animate-spin" />
        <span className="text-sm">正在解析 Word 文档...</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 p-8">
        <AlertTriangle className="size-10 text-destructive/60" />
        <p className="text-sm">文档加载失败</p>
        <p className="text-xs opacity-60">{errorMsg}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div
        className="docx-preview max-w-[780px] mx-auto p-6 text-sm leading-relaxed"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
