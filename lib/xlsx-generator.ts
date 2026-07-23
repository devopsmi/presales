import ExcelJS from "exceljs";
import type { QuotationRow, QuotationHeader, QuotedRates } from "@/lib/types";
import type { TradeRole } from "@/lib/constants";
import { TRADE_LABELS, TRADE_DAILY_RATES } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Constants — matching the example 报价单.xlsx style
// ---------------------------------------------------------------------------

const FONT_NAME = "微软雅黑";
const FONT_SIZE_TITLE = 18;
const FONT_SIZE_BODY = 12;
const HEADER_BG = "FFBDD7EE"; // light blue, matching example

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert 1-based column index to Excel column letter (A=1, Z=26, AA=27). */
function toColLetter(n: number): string {
  let s = "";
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

function baseFont(bold = false): Partial<ExcelJS.Font> {
  return { name: FONT_NAME, size: FONT_SIZE_BODY, bold };
}

function centerAlign(wrap = true): Partial<ExcelJS.Alignment> {
  return { horizontal: "center", vertical: "middle", wrapText: wrap };
}

function leftAlign(wrap = true): Partial<ExcelJS.Alignment> {
  return { horizontal: "left", vertical: "middle", wrapText: wrap };
}

function setDataCell(
  row: ExcelJS.Row,
  col: number,
  value: string | number,
  center = false,
): void {
  const cell = row.getCell(col);
  cell.value = value;
  cell.font = baseFont();
  cell.alignment = center ? centerAlign() : leftAlign();
}

function setSummaryLabel(row: ExcelJS.Row, col: number, label: string): void {
  const cell = row.getCell(col);
  cell.value = label;
  cell.font = baseFont(true);
  cell.alignment = leftAlign(false);
}

function setSummaryFormula(
  row: ExcelJS.Row,
  col: number,
  formula: string,
): void {
  const cell = row.getCell(col);
  cell.value = { formula };
  cell.font = baseFont(true);
  cell.alignment = centerAlign(false);
}

function setSummaryValue(
  row: ExcelJS.Row,
  col: number,
  value: number,
): void {
  const cell = row.getCell(col);
  cell.value = value;
  cell.font = baseFont(true);
  cell.alignment = centerAlign(false);
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

export async function generateQuotationXlsx(
  rows: QuotationRow[],
  trades: TradeRole[],
  header: QuotationHeader,
  quotedRates?: QuotedRates,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("报价单");

  const fixedCols = ["序号", "模块", "子模块", "功能", "子功能", "功能描述"];
  const remarkCol = "备注";
  const totalCols = fixedCols.length + trades.length + 1; // +1 for 备注
  const firstTradeCol = fixedCols.length + 1; // 1-based column index
  const lastColLetter = toColLetter(totalCols);

  // =========================================================================
  // Row 1 — Title
  // =========================================================================
  sheet.mergeCells(1, 1, 1, totalCols);
  const titleCell = sheet.getCell("A1");
  titleCell.value = `${header.vendorName}软件报价清单（金额：元）`;
  titleCell.font = { name: FONT_NAME, size: FONT_SIZE_TITLE, bold: true };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(1).height = 37.5;

  // =========================================================================
  // Row 2 — Client name + Vendor
  // =========================================================================
  sheet.mergeCells(2, 1, 2, 2); // A2:B2
  sheet.mergeCells(2, 3, 2, 4); // C2:D2
  sheet.mergeCells(2, 6, 2, totalCols); // F2:lastCol

  sheet.getCell("A2").value = "客户名称：";
  sheet.getCell("C2").value = header.customerName;
  sheet.getCell("E2").value = "报价单位：";
  sheet.getCell("F2").value = header.vendorName;

  const row2 = sheet.getRow(2);
  row2.font = baseFont();
  row2.alignment = { vertical: "middle" };
  row2.height = 17.4;

  // =========================================================================
  // Row 3 — Project name + Date
  // =========================================================================
  sheet.mergeCells(3, 1, 3, 2); // A3:B3
  sheet.mergeCells(3, 3, 3, 4); // C3:D3
  sheet.mergeCells(3, 6, 3, totalCols); // F3:lastCol

  sheet.getCell("A3").value = "项目名称：";
  sheet.getCell("C3").value = header.projectName;
  sheet.getCell("E3").value = "报价时间：";

  const dateCell = sheet.getCell("F3");
  dateCell.value = new Date(header.quoteDate);
  dateCell.numFmt = "yyyy-mm-dd";

  const row3 = sheet.getRow(3);
  row3.font = baseFont();
  row3.alignment = { vertical: "middle" };
  row3.height = 17.4;

  // =========================================================================
  // Row 4 — Column headers
  // =========================================================================
  const headerRow = sheet.getRow(4);
  headerRow.height = 17.4;

  const allHeaders = [
    ...fixedCols,
    ...trades.map((t) => TRADE_LABELS[t]),
    remarkCol,
  ];

  for (let i = 0; i < allHeaders.length; i++) {
    const cell = headerRow.getCell(i + 1);
    cell.value = allHeaders[i];
    cell.font = { name: FONT_NAME, size: FONT_SIZE_BODY, bold: true };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: HEADER_BG },
    };
    cell.alignment = centerAlign();
  }

  // =========================================================================
  // Data rows — starting at row 5
  // =========================================================================
  const DATA_START = 5;
  const DATA_END = DATA_START + rows.length - 1;

  for (let ri = 0; ri < rows.length; ri++) {
    const r = rows[ri];
    const rowNum = DATA_START + ri;
    const row = sheet.getRow(rowNum);

    setDataCell(row, 1, r.seq, true);
    setDataCell(row, 2, r.module);
    setDataCell(row, 3, r.sub_module);
    setDataCell(row, 4, r.function);
    setDataCell(row, 5, r.sub_function);
    setDataCell(row, 6, r.description);

    // Trade columns
    for (let ti = 0; ti < trades.length; ti++) {
      const val = r.trades[trades[ti]];
      const display = val === null || val === undefined ? "-" : val;
      setDataCell(row, firstTradeCol + ti, display, true);
    }

    // Remark column
    const remarkColIdx = firstTradeCol + trades.length;
    setDataCell(row, remarkColIdx, r.remark || "-", true);
  }

  // =========================================================================
  // Column widths (matching example)
  // =========================================================================
  sheet.getColumn(1).width = 5.88; // 序号
  sheet.getColumn(2).width = 11.88; // 模块
  sheet.getColumn(3).width = 31.25; // 子模块
  sheet.getColumn(4).width = 25.75; // 功能
  sheet.getColumn(5).width = 39.5; // 子功能
  sheet.getColumn(6).width = 75; // 功能描述
  for (let ti = 0; ti < trades.length; ti++) {
    sheet.getColumn(firstTradeCol + ti).width = 10;
  }
  sheet.getColumn(firstTradeCol + trades.length).width = 17; // 备注

  // =========================================================================
  // Data cell borders
  // =========================================================================
  for (let r = DATA_START; r <= DATA_END; r++) {
    for (let c = 1; c <= totalCols; c++) {
      sheet.getCell(r, c).border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    }
  }

  // =========================================================================
  // rowSpan merges (module → sub_module → function → sub_function)
  // =========================================================================
  mergeGroups(sheet, rows, DATA_START, 2, "module");
  mergeGroups(sheet, rows, DATA_START, 3, "sub_module");
  mergeGroups(sheet, rows, DATA_START, 4, "function");
  mergeGroups(sheet, rows, DATA_START, 5, "sub_function");

  // =========================================================================
  // Bottom summary section (only when there are data rows + trades)
  // =========================================================================
  if (rows.length > 0 && trades.length > 0) {
    const S = DATA_END + 2; // skip one empty row after data
    const firstTradeLetter = toColLetter(firstTradeCol);
    const lastTradeLetter = toColLetter(firstTradeCol + trades.length - 1);
    const remarkColIdx = firstTradeCol + trades.length;
    const remarkLetter = toColLetter(remarkColIdx);

    // -- Row S: 工时合计 = SUM per trade --
    setSummaryLabel(sheet.getRow(S), 1, "工时合计");
    for (let ti = 0; ti < trades.length; ti++) {
      const col = toColLetter(firstTradeCol + ti);
      setSummaryFormula(sheet.getRow(S), firstTradeCol + ti,
        `=SUM(${col}${DATA_START}:${col}${DATA_END})`);
    }
    sheet.mergeCells(S, 1, S, fixedCols.length);

    // -- Row S+1: 工时单价 --
    setSummaryLabel(sheet.getRow(S + 1), 1, "工时单价");
    for (let ti = 0; ti < trades.length; ti++) {
      const rate = quotedRates?.[trades[ti]] ?? TRADE_DAILY_RATES[trades[ti]];
      setSummaryValue(sheet.getRow(S + 1), firstTradeCol + ti, rate);
    }
    sheet.mergeCells(S + 1, 1, S + 1, fixedCols.length);

    // -- Row S+2: 工时费小计 = 单价 × 合计 --
    setSummaryLabel(sheet.getRow(S + 2), 1, "工时费小计");
    for (let ti = 0; ti < trades.length; ti++) {
      const col = toColLetter(firstTradeCol + ti);
      setSummaryFormula(sheet.getRow(S + 2), firstTradeCol + ti,
        `=${col}${S + 1}*${col}${S}`);
    }
    sheet.mergeCells(S + 2, 1, S + 2, fixedCols.length);

    // -- Row S+3: 工时费合计 = SUM(各工种小计) --
    setSummaryLabel(sheet.getRow(S + 3), 1, "工时费合计");
    sheet.mergeCells(S + 3, 1, S + 3, fixedCols.length);
    sheet.mergeCells(S + 3, firstTradeCol, S + 3, remarkColIdx);
    const gtFormula = `=SUM(${firstTradeLetter}${S + 2}:${lastTradeLetter}${S + 2})`;
    const gtCell = sheet.getCell(S + 3, firstTradeCol);
    gtCell.value = { formula: gtFormula };
    gtCell.font = baseFont(true);
    gtCell.alignment = centerAlign(false);

    // -- Row S+4: 利润15% --
    setSummaryLabel(sheet.getRow(S + 4), 1, "利润15%");
    sheet.mergeCells(S + 4, 1, S + 4, fixedCols.length);
    sheet.mergeCells(S + 4, firstTradeCol, S + 4, remarkColIdx);
    const profitCell = sheet.getCell(S + 4, firstTradeCol);
    profitCell.value = { formula: `=${firstTradeLetter}${S + 3}*15%` };
    profitCell.font = baseFont(true);
    profitCell.alignment = centerAlign(false);

    // -- Row S+5: 税金6% --
    setSummaryLabel(sheet.getRow(S + 5), 1, "税金6%");
    sheet.mergeCells(S + 5, 1, S + 5, fixedCols.length);
    sheet.mergeCells(S + 5, firstTradeCol, S + 5, remarkColIdx);
    const taxCell = sheet.getCell(S + 5, firstTradeCol);
    taxCell.value = {
      formula: `=(${firstTradeLetter}${S + 3}+${firstTradeLetter}${S + 4})*6%`,
    };
    taxCell.font = baseFont(true);
    taxCell.alignment = centerAlign(false);

    // -- Row S+6: 合计(最终) --
    setSummaryLabel(sheet.getRow(S + 6), 1, "合计");
    sheet.mergeCells(S + 6, 1, S + 6, fixedCols.length);
    sheet.mergeCells(S + 6, firstTradeCol, S + 6, remarkColIdx);
    const finalCell = sheet.getCell(S + 6, firstTradeCol);
    finalCell.value = {
      formula: `=${firstTradeLetter}${S + 3}+${firstTradeLetter}${S + 4}+${firstTradeLetter}${S + 5}`,
    };
    finalCell.font = baseFont(true);
    finalCell.alignment = centerAlign(false);

    // Summary cell borders
    for (let r = S; r <= S + 6; r++) {
      for (let c = 1; c <= remarkColIdx; c++) {
        sheet.getCell(r, c).border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
      }
    }

    // Also add thin border to the cells after data (empty row at DATA_END+1)
    for (let c = 1; c <= remarkColIdx; c++) {
      sheet.getCell(DATA_END + 1, c).border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    }
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

// ---------------------------------------------------------------------------
// rowSpan merge helper
// ---------------------------------------------------------------------------

function mergeGroups(
  sheet: ExcelJS.Worksheet,
  rows: QuotationRow[],
  dataStartRow: number,
  col: number,
  field: keyof QuotationRow,
): void {
  let start = 0;
  for (let i = 1; i <= rows.length; i++) {
    if (i === rows.length || rows[i][field] !== rows[start][field]) {
      if (i - start > 1) {
        sheet.mergeCells(dataStartRow + start, col, dataStartRow + i - 1, col);
      }
      start = i;
    }
  }
}
