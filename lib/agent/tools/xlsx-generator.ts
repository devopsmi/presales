import ExcelJS from "exceljs";
import type { QuotationRow, QuotationHeader } from "@/lib/agent/state";
import type { TradeRole } from "@/lib/constants";
import { TRADE_LABELS } from "@/lib/constants";

export async function generateQuotationXlsx(
  rows: QuotationRow[],
  trades: TradeRole[],
  header: QuotationHeader,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("报价单");

  // Column definitions
  const fixedCols = ["序号", "模块", "子模块", "功能", "子功能", "功能描述"];
  const tradeCols = trades.map((t) => TRADE_LABELS[t]);
  const allCols = [...fixedCols, ...tradeCols, "备注"];

  // Header info rows
  const headerRows: string[][] = [
    [`客户名称：${header.customerName}`],
    [`项目名称：${header.projectName}`],
    [`报价时间：${header.quoteDate}`],
    [`报价单位：${header.vendorName}`],
    [""],
  ];

  for (const hRow of headerRows) {
    sheet.addRow(hRow);
  }

  // Column headers
  const headerRow = sheet.addRow(allCols);
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: "center", vertical: "middle" };

  // Data rows
  for (const r of rows) {
    const row = sheet.addRow([
      r.seq,
      r.module,
      r.sub_module,
      r.function,
      r.sub_function,
      r.description,
      ...trades.map((t) => {
        const val = r.trades[t];
        return val === null || val === undefined ? "-" : val;
      }),
      r.remark || "-",
    ]);
    row.alignment = { vertical: "middle", wrapText: true };
  }

  // Column widths (1-indexed)
  sheet.getColumn(1).width = 6;   // 序号
  sheet.getColumn(2).width = 16;  // 模块
  sheet.getColumn(3).width = 22;  // 子模块
  sheet.getColumn(4).width = 16;  // 功能
  sheet.getColumn(5).width = 22;  // 子功能
  sheet.getColumn(6).width = 40;  // 功能描述
  for (let ci = 1; ci <= trades.length; ci++) {
    sheet.getColumn(6 + ci).width = 10;
  }
  const lastCol = 7 + trades.length;
  sheet.getColumn(lastCol).width = 20; // 备注

  // Merge cells for module/sub_module/function/sub_function columns
  // dataStartRow is 1-indexed: headerRows (5) + column header row (1) = 6
  const dataStartRow = headerRows.length + 1 + 1;
  mergeGroups(sheet, rows, dataStartRow, 2, "module");
  mergeGroups(sheet, rows, dataStartRow, 3, "sub_module");
  mergeGroups(sheet, rows, dataStartRow, 4, "function");
  mergeGroups(sheet, rows, dataStartRow, 5, "sub_function");

  // Style borders across all data cells
  const lastDataRow = dataStartRow + rows.length - 1;
  for (let r = dataStartRow; r <= lastDataRow; r++) {
    for (let c = 1; c <= allCols.length; c++) {
      const cell = sheet.getCell(r, c);
      cell.border = {
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