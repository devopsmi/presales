/**
 * File parsing utilities — PDF, Word, Excel, Image.
 *
 * Design principles (from XLSX/DOCX/PDF domain skills):
 *  - Preserve document structure (headings, lists, tables) so LLM can map
 *    hierarchy → functional decomposition levels.
 *  - Expose formula + format semantics (blue=input, yellow=assumption) for Excel.
 *  - Inject format-awareness hints so the file-parser sub-agent interprets
 *    each file type with the right mental model.
 */
// pdf-parse worker polyfills — sets up DOMMatrix / Path2D / ImageData for Node.js,
// pre-loads the pdfjs worker module, and exposes helper functions for worker setup.
import "pdf-parse/worker";
import { getData } from "pdf-parse/worker";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import ExcelJS from "exceljs";

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
// Shared helpers
// ---------------------------------------------------------------------------

/** ARGB hex → human label. */
function classifyCellStyle(
  fontColor: string | undefined | null,
  fillColor: string | undefined | null,
): string[] {
  const tags: string[] = [];
  const fc = (fontColor ?? "").toUpperCase();
  const fl = (fillColor ?? "").toUpperCase();
  // Blue font = user-input parameter (XLSX skill convention)
  if (fc === "FF0000FF" || fc === "0000FF") tags.push("🔵输入参数");
  // Yellow fill = key assumption / cell to fill in (XLSX skill convention)
  if (fl === "FFFFFF00" || fl === "FFFF00") tags.push("🟡关键假设/待填");
  // Green font = cross-sheet reference
  if (fc === "FF008000" || fc === "008000") tags.push("🔗跨表引用");
  // Red font = external file reference
  if (fc === "FFFF0000" || fc === "FF0000") tags.push("🔴外部文件引用");
  return tags;
}

/** numFmt string → semantic hint. */
function classifyNumFmt(fmt: string): string | null {
  if (!fmt) return null;
  if (fmt.includes("$") || fmt.includes("¥") || fmt.includes("£")) return "💰金额";
  if (fmt.includes("%")) return "📊百分比";
  if (fmt.includes("0.0x") || fmt.includes("0.00x")) return "🔢倍数";
  if (fmt.includes("0.00E+00")) return "🔬科学计数";
  if (fmt.includes("yyyy") || fmt.includes("mm") || fmt.includes("dd")) return "📅日期";
  return null;
}

// ---------------------------------------------------------------------------
// PDF — pdf-parse with structure-awareness hints
// ---------------------------------------------------------------------------

export async function parsePdf(
  buffer: Buffer,
  fileName: string,
): Promise<string> {
  PDFParse.setWorker(getData());
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const text = result.text;
    const isEmpty = !text || text.trim().length === 0;
    const isScanned = text.length < 50 && !isEmpty;

    const hints: string[] = [];
    if (isEmpty || isScanned) {
      hints.push("⚠️ 本文档可能是扫描件（图像型PDF），文本层为空或极不完整。");
      hints.push("   如需解析扫描件内容，请将文档重新上传为 Word 或可搜索 PDF。");
    }
    if (!isEmpty) {
      hints.push("📑 解析提示：");
      hints.push('   - 请匹配 \u201C第X章\u201D、\u201C第X节\u201D、数字编号（1. / 1.1 / 1.1.1）还原文档层级');
      hints.push("   - 若连续行含规律性空格/数字分隔 → 可能是表格数据，请重构为 Markdown 表格理解");
      hints.push("   - 页眉页脚中每页重复的相同内容（如公司名/机密标记）不是正文需求");
      hints.push(`   - 文档总字符数：${text.length}`);
    }

    return hints.join("\n") + (isEmpty ? "" : "\n\n---\n" + text);
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
// Word — mammoth HTML mode to preserve headings / lists / bold-italic
// ---------------------------------------------------------------------------

export async function parseWord(
  buffer: Buffer,
  fileName: string,
): Promise<string> {
  try {
    const result = await mammoth.convertToHtml({ buffer });
    const warnings = result.messages
      .filter((m) => m.type === "warning")
      .map((m) => m.message);

    const hints: string[] = [
      "📐 Word 文档解析提示（结构已保留）：",
      "   - 标题级次（h1/h2/h3）映射到功能拆解层次：h1=业务域，h2=功能模块，h3=具体功能点",
      "   - 编号列表或项目符号中的每一项都应作为独立功能点考量",
      "   - <strong>/<em> 标记的文本通常是技术约束或核心需求",
      "   - ⚠️ 若文档中出现自相矛盾或重复描述，可能是未接受修订的残留内容，请标记两套方案",
      "",
    ];

    if (warnings.length > 0) {
      hints.push(`⚠️ mammoth 转换警告 (${warnings.length} 条):`);
      warnings.slice(0, 5).forEach((w) => hints.push(`   - ${w}`));
      hints.push("");
    }

    return hints.join("\n") + result.value;
  } catch (err) {
    throw new FileParseError(
      err instanceof Error ? err.message : "Unknown error",
      "word",
      fileName,
    );
  }
}

// ---------------------------------------------------------------------------
// Excel — exceljs double-channel (formula + value + format semantics)
// ---------------------------------------------------------------------------

export async function parseExcel(
  buffer: Buffer,
  fileName: string,
): Promise<string> {
  try {
    const wb = new ExcelJS.Workbook();
    // exceljs types declare Buffer as interface Buffer extends ArrayBuffer {},
    // which conflicts with Node 22+ Buffer<T> typing. Passing buffer.buffer resolves it.
    await wb.xlsx.load(buffer.buffer as ArrayBuffer);
    const sheetOutputs: string[] = [];

    wb.eachSheet((ws) => {
      const lines: string[] = [];
      lines.push(`## Sheet: ${ws.name}`);

      // --- Column format hints ---
      const colHints = new Map<number, Set<string>>();
      const cellTags: string[] = []; // per-cell annotations

      // Sample first 50 rows to classify formats
      let sampled = 0;
      ws.eachRow({ includeEmpty: false }, (row) => {
        if (sampled >= 50) return;
        sampled++;
        row.eachCell({ includeEmpty: false }, (cell) => {
          const col = +cell.col;
          if (typeof cell.numFmt === "string") {
            const hint = classifyNumFmt(cell.numFmt);
            if (hint) {
              if (!colHints.has(col)) colHints.set(col, new Set());
              colHints.get(col)!.add(hint);
            }
          }
          const styleTags = classifyCellStyle(
            cell.font?.color?.argb,
            cell.style.fill as Record<string, unknown> | undefined ?
              (cell.style.fill as { fgColor?: { argb?: string } }).fgColor?.argb : undefined,
          );
          for (const t of styleTags) {
            cellTags.push(`${t} ${cell.address}`);
          }
        });
      });

      // Print format section
      if (colHints.size > 0) {
        lines.push("");
        lines.push("### 列格式提示");
        for (const [col, hints] of colHints) {
          const letter = String.fromCharCode(64 + col);
          lines.push(`- 列 ${letter}(${col}): ${[...hints].join(", ")}`);
        }
      }
      if (cellTags.length > 0) {
        lines.push("");
        lines.push("### 单元格标记");
        cellTags.forEach((t) => lines.push(`- ${t}`));
      }
      lines.push("");

      // --- Data as Markdown table ---
      const rows = ws.getSheetValues();
      if (rows && rows.length > 0 && Array.isArray(rows[0])) {
        // First row = header
        lines.push("### 数据");
        const headerRow = (rows[0] as unknown[]).filter((_, i) => i > 0); // exceljs rows start at index 1
        if (headerRow.length > 0) {
          // Build header
          const header = headerRow.map((c) => String(c ?? ""));
          lines.push("| " + header.join(" | ") + " |");
          lines.push("|" + header.map(() => "---").join("|") + "|");

          // Build data rows
          for (let r = 2; r <= Math.min(rows.length, 200); r++) {
            const dataRow = rows[r] as unknown[];
            if (!dataRow || dataRow.every((c) => c === undefined || c === null || c === "")) continue;
            const cells = dataRow.slice(1).map((cellVal, i) => {
              const colNum = i + 1;
              const cellAddr = `${String.fromCharCode(64 + colNum)}${r}`;
              // Try to get formula from the worksheet cell
              let formula = "";
              try {
                const cell = ws.getCell(cellAddr);
                if (cell.formula) formula = ` (==${cell.formula})`;
              } catch { /* ignore */ }
              const display = cellVal != null ? String(cellVal) : "";
              return display + formula;
            });
            lines.push("| " + cells.join(" | ") + " |");
          }
        }
      }

      // --- Fallback: if getSheetValues didn't produce a good table, do row-by-row ---
      if (!lines.includes("### 数据")) {
        lines.push("");
        lines.push("### 数据（逐行）");
        ws.eachRow({ includeEmpty: false }, (row) => {
          const cells: string[] = [];
          row.eachCell({ includeEmpty: false }, (cell) => {
            let display = cell.value != null ? String(cell.value) : "";
            if (cell.formula) display += ` (==${cell.formula})`;
            cells.push(display);
          });
          if (cells.length > 0) lines.push(cells.join("\t"));
        });
      }

      sheetOutputs.push(lines.join("\n"));
    });

    return sheetOutputs.join("\n\n---\n\n");
  } catch (err) {
    // Fallback to old xlsx parser if exceljs fails (e.g. password-protected file)
    try {
      const { default: xlsxFallback } = await import("xlsx");
      const workbook = xlsxFallback.read(buffer, { type: "buffer" });
      const texts: string[] = [];
      workbook.SheetNames.forEach((name) => {
        const sheet = workbook.Sheets[name];
        const csv = xlsxFallback.utils.sheet_to_csv(sheet);
        texts.push(`[Sheet: ${name}]\n${csv}`);
      });
      return texts.join("\n\n");
    } catch {
      throw new FileParseError(
        err instanceof Error ? err.message : "Unknown error",
        "excel",
        fileName,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Image — uses sharp for metadata
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
      `📷 图片文件: ${fileName}`,
      `格式: ${format}`,
      `尺寸: ${width}x${height}`,
      `注: 图片具体内容需通过视觉模型分析`,
    ].join(", ");
  } catch {
    return `📷 图片文件: ${fileName} (无法解析元数据)`;
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
