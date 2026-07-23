import ExcelJS from "exceljs";
import { generateQuotationXlsx } from "../xlsx-generator";
import type { QuotationRow, QuotationHeader } from "@/lib/types";
import type { TradeRole } from "@/lib/constants";

async function testAll() {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string): void {
    if (condition) {
      console.log(`  PASS: ${name}`);
      passed++;
    } else {
      console.error(`  FAIL: ${name}`);
      failed++;
    }
  }

  const header: QuotationHeader = {
    customerName: "测试客户",
    projectName: "测试项目",
    quoteDate: "2026-07-20",
    vendorName: "测试单位",
  };

  const rows: QuotationRow[] = [
    { seq: 1, module: "系统设计", sub_module: "框架设计", function: "框架建设", sub_function: "框架建设", description: "前后端基础技术栈选型架构搭建", category: "design", trades: { frontend: 1, backend: 3, design: 0.5 }, remark: "" },
    { seq: 2, module: "系统设计", sub_module: "数据设计", function: "数据建模", sub_function: "数据建模", description: "数据建模", category: "design", trades: { frontend: 0, backend: 2, design: 1 }, remark: "" },
    { seq: 3, module: "可视化大屏", sub_module: "运营看板", function: "总营收", sub_function: "营收总额", description: "统计所有分公司当年总营收", category: "feature", trades: { frontend: 0.5, backend: 0.5, design: 3 }, remark: "详见原型" },
    { seq: 4, module: "可视化大屏", sub_module: "运营看板", function: "分公司营收", sub_function: "各分公司营收", description: "统计每个分公司当年总营收", category: "feature", trades: { frontend: 0.5, backend: null, design: null }, remark: "" },
  ];

  const trades: TradeRole[] = ["frontend", "backend", "design"];

  const buffer = await generateQuotationXlsx(rows, trades, header);

  // Verify it's a valid buffer
  assert(buffer.length > 0, "generateQuotationXlsx returns non-empty buffer");
  assert(Buffer.isBuffer(buffer), "generateQuotationXlsx returns a Buffer");

  // Verify it starts with ZIP magic bytes (.xlsx is a ZIP)
  const magic = buffer[0] === 0x50 && buffer[1] === 0x4b;
  assert(magic, "Output has ZIP magic bytes (valid .xlsx)");

  // Re-parse to verify content
  const reparsed = new ExcelJS.Workbook();
  const arrayBuf = new Uint8Array(buffer).buffer.slice(0);
  await reparsed.xlsx.load(arrayBuf);
  const reparsedSheet = reparsed.getWorksheet("报价单");
  assert(reparsedSheet !== undefined, "Re-parsed workbook contains '报价单' worksheet");

  if (reparsedSheet) {
    // ---- Row 1: Title ----
    const titleCell = String(reparsedSheet.getCell(1, 1).value ?? "");
    assert(
      titleCell.includes("测试单位") && titleCell.includes("软件报价清单"),
      `Row 1 title contains vendor name and label (got "${titleCell.slice(0, 50)}")`,
    );

    // ---- Row 2: Client name + Vendor ----
    const customerCell = String(reparsedSheet.getCell("C2").value ?? "");
    assert(customerCell === "测试客户", `Row 2 C2 = customer name (got "${customerCell}")`);

    const vendorCell = String(reparsedSheet.getCell("F2").value ?? "");
    assert(vendorCell === "测试单位", `Row 2 F2 = vendor name (got "${vendorCell}")`);

    // ---- Row 3: Project name + Date ----
    const projectCell = String(reparsedSheet.getCell("C3").value ?? "");
    assert(projectCell === "测试项目", `Row 3 C3 = project name (got "${projectCell}")`);

    // Date is stored as a Date object in ExcelJS; verify via numFmt
    const dateCell = reparsedSheet.getCell("F3");
    assert(
      dateCell.numFmt === "yyyy-mm-dd",
      `Row 3 F3 has date number format (got "${dateCell.numFmt}")`,
    );

    // ---- Row 4: Column headers ----
    const colHeaderA4 = String(reparsedSheet.getCell("A4").value ?? "");
    assert(colHeaderA4 === "序号", `Row 4 A4 = '序号' (got "${colHeaderA4}")`);

    const colHeaderG4 = String(reparsedSheet.getCell(4, 7).value ?? "");
    assert(colHeaderG4 === "前端开发", `Row 4 col 7 = '前端开发' (got "${colHeaderG4}")`);

    const colHeaderI4 = String(reparsedSheet.getCell(4, 9).value ?? "");
    assert(colHeaderI4 === "UI 设计", `Row 4 col 9 = 'UI 设计' (got "${colHeaderI4}")`);

    const colHeaderJ4 = String(reparsedSheet.getCell(4, 10).value ?? "");
    assert(colHeaderJ4 === "备注", `Row 4 col 10 = '备注' (got "${colHeaderJ4}")`);

    // ---- Header style checks ----
    const headerFont = reparsedSheet.getCell("A4").font;
    assert(headerFont?.bold === true, "Header row font is bold");

    // ---- Data rows (start at row 5) ----
    const seqCell = reparsedSheet.getCell(5, 1).value;
    assert(seqCell === 1, `First data row seq=1 (got ${String(seqCell)})`);

    const moduleCell = reparsedSheet.getCell(5, 2);
    assert(moduleCell.value === "系统设计", `Module cell value (got ${String(moduleCell.value)})`);

    // Trade value (backend col 8)
    const backendVal = reparsedSheet.getCell(5, 8).value;
    assert(backendVal === 3, `Backend trade value (got ${String(backendVal)})`);

    // Null trade value becomes "-"
    const nullTradeCell = reparsedSheet.getCell(8, 8);
    assert(nullTradeCell.value === "-", `Null trade value rendered as '-' (got ${String(nullTradeCell.value)})`);

    // Empty remark becomes "-"
    const remarkCell = reparsedSheet.getCell(5, 10);
    assert(remarkCell.value === "-", `Empty remark rendered as '-' (got ${String(remarkCell.value)})`);

    // Non-empty remark
    const remarkCellReal = reparsedSheet.getCell(7, 10);
    assert(remarkCellReal.value === "详见原型", `Non-empty remark (got ${String(remarkCellReal.value)})`);

    // ---- Merge logic ----
    const merges = (reparsedSheet as unknown as { _merges: Record<string, unknown> })._merges;
    const mergeCount = merges ? Object.keys(merges).length : 0;
    // Data merges (3): module col B rows 5-6, module col B rows 7-8, sub_module col C rows 7-8
    // Title merge (1): A1 across all cols
    // Meta merges: A2:B2, C2:D2, F2:J2, A3:B3, C3:D3, F3:J3 → 6 merges
    // Summary label merges (7): A-F for rows S..S+6
    // Summary value merges (4): trade cols for rows S+3..S+6 (工时费合计, 利润, 税金, 合计)
    // Expected: 3 (data) + 1 (title) + 6 (meta) + 7 (summary labels) + 4 (summary values) = 21
    assert(mergeCount === 21, `Merge logic: expected 21 merges, got ${mergeCount}`);

    // ---- Bottom summary section ----
    // Data ends at row 8, so summary starts at row 10 (8+2)
    const sumRow = reparsedSheet.getCell(10, 1).value;
    assert(sumRow === "工时合计", `Summary row 10 label = '工时合计' (got ${String(sumRow)})`);

    const unitPriceRow = reparsedSheet.getCell(11, 1).value;
    assert(unitPriceRow === "工时单价", `Summary row 11 label = '工时单价' (got ${String(unitPriceRow)})`);

    // Verify a formula exists in the 工时合计 row
    const sumFormulaCell = reparsedSheet.getCell(10, 7); // G10 = SUM for frontend
    const sumCellVal = sumFormulaCell.value;
    assert(
      typeof sumCellVal === "object" && sumCellVal !== null && "formula" in sumCellVal,
      `工时合计 cell has formula object (got ${typeof sumCellVal})`,
    );

    // Verify frontend daily rate
    const rateCell = reparsedSheet.getCell(11, 7); // G11 = frontend daily rate
    assert(rateCell.value === 2000, `Frontend daily rate = 2000 (got ${rateCell.value})`);

    // Verify final 合计 row exists
    const finalRow = reparsedSheet.getCell(16, 1).value;
    assert(finalRow === "合计", `Final summary row label = '合计' (got ${String(finalRow)})`);
  }

  // Test with empty rows
  const emptyBuffer = await generateQuotationXlsx([], trades, header);
  assert(emptyBuffer.length > 0, "Empty rows produces non-empty buffer");
  const emptyMagic = emptyBuffer[0] === 0x50 && emptyBuffer[1] === 0x4b;
  assert(emptyMagic, "Empty rows output is valid .xlsx");

  // Test with different trade count
  const singleTradeRows: QuotationRow[] = [
    { seq: 1, module: "A", sub_module: "B", function: "C", sub_function: "D", description: "E", category: "feature", trades: { frontend: 5 }, remark: "test" },
  ];
  const singleTradeBuffer = await generateQuotationXlsx(singleTradeRows, ["frontend"], header);
  assert(singleTradeBuffer.length > 0, "Single trade produces non-empty buffer");

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

testAll();
