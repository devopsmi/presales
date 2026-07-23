"use client";

import { useRef } from "react";
import { Paperclip, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { usePresales } from "@/lib/presales-context";
import { MAX_FILE_SIZE_MB } from "@/lib/constants";

export function FileUploadMenu() {
  const pdfRef = useRef<HTMLInputElement>(null);
  const wordRef = useRef<HTMLInputElement>(null);
  const excelRef = useRef<HTMLInputElement>(null);
  const { attachments, addAttachments, uploadError, setUploadError } = usePresales();

  function handleFiles(files: FileList | null) {
    if (!files) return;
    const valid: File[] = [];
    const rejected: string[] = [];
    for (const f of Array.from(files)) {
      if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        rejected.push(`${f.name} (${(f.size / 1024 / 1024).toFixed(1)}MB > ${MAX_FILE_SIZE_MB}MB)`);
        continue;
      }
      valid.push(f);
    }
    if (valid.length > 0) addAttachments(valid);
    if (rejected.length > 0) {
      setUploadError(`以下文件超过 ${MAX_FILE_SIZE_MB}MB 限制: ${rejected.join(", ")}`);
    }
  }

  return (
    <>
      <input
        ref={pdfRef}
        type="file"
        accept=".pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={wordRef}
        type="file"
        accept=".docx,.doc"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={excelRef}
        type="file"
        accept=".xlsx,.xls"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <DropdownMenu>
        <DropdownMenuTrigger>
          <span className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer">
            <Paperclip className="size-4" />
            <span>上传文件</span>
            {attachments.length > 0 && (
              <Badge variant="secondary" className="ml-0.5 h-5 px-1 text-xs">
                {attachments.length}
              </Badge>
            )}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem onClick={() => pdfRef.current?.click()}>
            PDF 文档 (.pdf)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => wordRef.current?.click()}>
            Word 文档 (.docx, .doc)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => excelRef.current?.click()}>
            Excel 表格 (.xlsx, .xls)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {uploadError && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 text-xs text-destructive-foreground bg-destructive/90 px-3 py-2 rounded-md shadow-lg max-w-lg">
          <span className="truncate">{uploadError}</span>
          <button onClick={() => setUploadError(null)} className="shrink-0 hover:bg-destructive-foreground/10 rounded p-0.5">
            <X className="size-3" />
          </button>
        </div>
      )}
    </>
  );
}
