import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import * as XLSX from "xlsx";

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

export async function parsePdf(buffer: Buffer, fileName: string): Promise<string> {
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

export async function parseWord(buffer: Buffer, fileName: string): Promise<string> {
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

export async function parseExcel(buffer: Buffer, fileName: string): Promise<string> {
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

export async function parseFile(
  buffer: Buffer,
  fileType: "pdf" | "word" | "excel",
  fileName: string,
): Promise<string> {
  switch (fileType) {
    case "pdf":
      return parsePdf(buffer, fileName);
    case "word":
      return parseWord(buffer, fileName);
    case "excel":
      return parseExcel(buffer, fileName);
  }
}
