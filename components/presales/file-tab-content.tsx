"use client";

import { useEffect, useState } from "react";
import type { FileTab } from "@/lib/types";
import { FileText, Loader2, Eye, Brain } from "lucide-react";
import { cn } from "@/lib/utils";
import { PdfPreview } from "./file-preview/pdf-preview";
import { DocxPreview } from "./file-preview/docx-preview";
import { XlsxPreview } from "./file-preview/xlsx-preview";

type ContentState =
  | { status: "loading" }
  | { status: "text"; content: string }
  | { status: "image"; url: string }
  | { status: "error"; message: string };

type SubTab = "preview" | "parsed";

const TEXT_EXTENSIONS = new Set([
  "txt", "csv", "tsv", "json", "xml", "yaml", "yml", "md",
  "js", "ts", "jsx", "tsx", "py", "rb", "go", "rs", "java",
  "kt", "swift", "c", "cpp", "h", "hpp", "cs", "php", "sql",
  "html", "css", "scss", "less", "log", "env", "cfg", "ini",
  "toml", "sh", "bash", "zsh",
]);

const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico",
]);

const DOCX_EXTENSIONS = new Set(["docx", "doc"]);
const XLSX_EXTENSIONS = new Set(["xlsx", "xls", "xlsm", "xlsb"]);
const PDF_EXTENSIONS = new Set(["pdf"]);

function getExtension(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function RawTextPreview({ content }: { content: string }) {
  return (
    <pre className="p-4 text-xs font-mono leading-relaxed whitespace-pre-wrap break-all text-foreground/90">
      {content || "(空文件)"}
    </pre>
  );
}

function ParsedMarkdown({ content }: { content: string }) {
  return (
    <div className="p-4 text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
      {content}
    </div>
  );
}

function FilePreview({ tab, ext }: { tab: FileTab; ext: string }) {
  const [contentState, setContentState] = useState<ContentState>({ status: "loading" });

  useEffect(() => {
    if (IMAGE_EXTENSIONS.has(ext)) {
      const url = URL.createObjectURL(tab.file);
      setContentState({ status: "image", url });
      return () => URL.revokeObjectURL(url);
    }

    if (TEXT_EXTENSIONS.has(ext) || ext === "") {
      let cancelled = false;
      const reader = new FileReader();
      reader.onload = () => {
        if (cancelled) return;
        const text = reader.result as string;
        if (text.includes("\x00")) {
          setContentState({
            status: "error",
            message: "无法显示二进制文件内容",
          });
        } else {
          setContentState({ status: "text", content: text.slice(0, 500000) });
        }
      };
      reader.onerror = () => {
        if (cancelled) return;
        setContentState({ status: "error", message: "文件读取失败" });
      };
      reader.readAsText(tab.file);
      return () => {
        cancelled = true;
        reader.abort();
      };
    }

    setContentState({
      status: "error",
      message: `${ext.toUpperCase() || "未知"} 文件不支持预览`,
    });
  }, [tab, ext]);

  if (contentState.status === "loading") {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
        <Loader2 className="size-5 animate-spin" />
        <span className="text-sm">正在读取文件...</span>
      </div>
    );
  }

  if (contentState.status === "error") {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 p-8">
        <FileText className="size-12 opacity-30" />
        <div className="text-center">
          <p className="text-xs opacity-60 mt-2">{contentState.message}</p>
        </div>
      </div>
    );
  }

  if (contentState.status === "image") {
    return (
      <img
        src={contentState.url}
        alt={tab.name}
        className="max-w-full max-h-full object-contain rounded-md shadow-sm"
      />
    );
  }

  return <RawTextPreview content={contentState.content} />;
}

export function FileTabContent({ tab }: { tab: FileTab }) {
  const [subTab, setSubTab] = useState<SubTab>("preview");
  const ext = getExtension(tab.name);

  const hasRichPreview = PDF_EXTENSIONS.has(ext) || DOCX_EXTENSIONS.has(ext) || XLSX_EXTENSIONS.has(ext);

  const rawPreview = (
    <div className="h-full overflow-auto">
      <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-1.5 bg-muted/50 border-b text-xs text-muted-foreground">
        <FileText className="size-3.5" />
        <span className="font-medium truncate">{tab.name}</span>
        <span className="ml-auto shrink-0">{formatFileSize(tab.size)}</span>
      </div>
      <FilePreview tab={tab} ext={ext} />
    </div>
  );

  const richPreview = (() => {
    if (PDF_EXTENSIONS.has(ext)) return <PdfPreview tab={tab} />;
    if (DOCX_EXTENSIONS.has(ext)) return <DocxPreview tab={tab} />;
    if (XLSX_EXTENSIONS.has(ext)) return <XlsxPreview tab={tab} />;
    return rawPreview;
  })();

  if (!tab.parsed) {
    return richPreview;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center border-b bg-muted/30 shrink-0 px-2">
        <button
          onClick={() => setSubTab("preview")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-xs border-b-2 transition-colors",
            subTab === "preview"
              ? "border-primary text-foreground font-medium"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <Eye className="size-3.5" />
          <span>预览</span>
        </button>
        <button
          onClick={() => setSubTab("parsed")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-xs border-b-2 transition-colors",
            subTab === "parsed"
              ? "border-primary text-foreground font-medium"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <Brain className="size-3.5" />
          <span>解析结果</span>
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {subTab === "preview" ? (
          richPreview
        ) : (
          <div className="h-full overflow-auto">
            <ParsedMarkdown content={tab.parsed!} />
          </div>
        )}
      </div>
    </div>
  );
}
