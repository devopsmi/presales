"use client";

import { useRef } from "react";
import { Paperclip } from "lucide-react";
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
  const { attachments, addAttachments } = usePresales();

  function handleFiles(files: FileList | null) {
    if (!files) return;
    const valid: File[] = [];
    for (const f of Array.from(files)) {
      if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        continue;
      }
      valid.push(f);
    }
    if (valid.length > 0) addAttachments(valid);
  }

  return (
    <>
      <input
        ref={pdfRef}
        type="file"
        accept=".pdf"
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
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <DropdownMenu>
        <DropdownMenuTrigger>
          <button className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <Paperclip className="size-4" />
            <span>上传文件</span>
            {attachments.length > 0 && (
              <Badge variant="secondary" className="ml-0.5 h-5 px-1 text-xs">
                {attachments.length}
              </Badge>
            )}
          </button>
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
    </>
  );
}
