/**
 * File parsing utilities — PDF, Word, Excel, Image.
 *
 * Recovered from old lib/agent/tools/file-parser.ts (commit d85f309).
 * Added lookAtImage() using sharp for image metadata extraction.
 */
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import * as XLSX from "xlsx";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class FileParseError extends Error {
  constructor(
    message: string,
    public readonly fileType: string,
    public readonly fileName: string,
  ) {
    super(`Failed to parse ${fileType} file "${fileName}": ${message}`);
    this.name = "FileParseError";
  }
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

export async function parsePdf(
  buffer: Buffer,
  fileName: string,
): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } catch (err) {
    throw new FileParseError(
      err instanceof Error ? err.message : "Unknown error",
      "pdf",
      fileName,
    );
  } finally {
    await parser.destroy();
  }
}

// ---------------------------------------------------------------------------
// Word
// ---------------------------------------------------------------------------

export async function parseWord(
  buffer: Buffer,
  fileName: string,
): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (err) {
    throw new FileParseError(
      err instanceof Error ? err.message : "Unknown error",
      "word",
      fileName,
    );
  }
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

export async function parseExcel(
  buffer: Buffer,
  fileName: string,
): Promise<string> {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const texts: string[] = [];
    workbook.SheetNames.forEach((name) => {
      const sheet = workbook.Sheets[name];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      texts.push(`[Sheet: ${name}]\n${csv}`);
    });
    return texts.join("\n\n");
  } catch (err) {
    throw new FileParseError(
      err instanceof Error ? err.message : "Unknown error",
      "excel",
      fileName,
    );
  }
}

// ---------------------------------------------------------------------------
// Image (NEW) — uses sharp for metadata
// ---------------------------------------------------------------------------

export async function lookAtImage(
  buffer: Buffer,
  fileName: string,
): Promise<string> {
  try {
    const sharpModule = await import("sharp");
    const sharp = sharpModule.default;
    const metadata = await sharp(buffer).metadata();
    const format = metadata.format ?? "unknown";
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    return [
      `图片文件: ${fileName}`,
      `格式: ${format}`,
      `尺寸: ${width}x${height}`,
      `注: 图片具体内容需通过视觉模型分析`,
    ].join(", ");
  } catch {
    return `图片文件: ${fileName} (无法解析元数据)`;
  }
}

// ---------------------------------------------------------------------------
// Unified parse (dispatch by type)
// ---------------------------------------------------------------------------

export async function parseFile(
  buffer: Buffer,
  fileType: "pdf" | "word" | "excel" | "image",
  fileName: string,
): Promise<string> {
  switch (fileType) {
    case "pdf":
      return parsePdf(buffer, fileName);
    case "word":
      return parseWord(buffer, fileName);
    case "excel":
      return parseExcel(buffer, fileName);
    case "image":
      return lookAtImage(buffer, fileName);
  }
}
