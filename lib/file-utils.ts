"use client";

export interface SerializedFile {
  name: string;
  type: "pdf" | "word" | "excel";
  data: string; // base64-encoded content
}

function detectFileType(name: string): "pdf" | "word" | "excel" {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (ext === "docx" || ext === "doc") return "word";
  if (ext === "xlsx" || ext === "xls") return "excel";
  // Default fallback — try to parse as word-like
  return "word";
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
): Promise<SerializedFile[]> {
  const results: SerializedFile[] = [];
  for (const file of files) {
    try {
      const data = await fileToBase64(file);
      results.push({
        name: file.name,
        type: detectFileType(file.name),
        data,
      });
    } catch (err) {
      console.error(`Failed to serialize file "${file.name}":`, err);
      // Skip files that fail to read
    }
  }
  return results;
}
