"use client";

export interface SerializedFile {
  name: string;
  type: "pdf" | "word" | "excel" | "image";
  data: string; // base64-encoded content
}

export interface SerializeResult {
  files: SerializedFile[];
  errors: Array<{ name: string; error: string }>;
}

function detectFileType(name: string): "pdf" | "word" | "excel" | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (ext === "docx" || ext === "doc") return "word";
  if (ext === "xlsx" || ext === "xls") return "excel";
  return null;
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data URL prefix (e.g., "data:application/pdf;base64,")
      const base64 = result.includes("base64,")
        ? result.split("base64,")[1]
        : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export async function serializeFiles(
  files: File[],
): Promise<SerializeResult> {
  const results: SerializedFile[] = [];
  const errors: Array<{ name: string; error: string }> = [];
  for (const file of files) {
    try {
      const type = detectFileType(file.name);
      if (!type) {
        errors.push({ name: file.name, error: "不支持的文件类型" });
        continue;
      }
      const data = await fileToBase64(file);
      results.push({
        name: file.name,
        type,
        data,
      });
    } catch (err) {
      console.error(`Failed to serialize file "${file.name}":`, err);
      errors.push({ name: file.name, error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
  return { files: results, errors };
}
