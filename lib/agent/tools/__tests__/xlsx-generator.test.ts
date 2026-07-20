import ExcelJS from "exceljs";
import { generateQuotationXlsx } from "../xlsx-generator";
import type { QuotationRow, QuotationHeader } from "@/lib/agent/state";
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

  // Re-parse to verify content (XLSX is a compressed ZIP, can't grep raw bytes)
  const reparsed = new ExcelJS.Workbook();
  const arrayBuf = new Uint8Array(buffer).buffer.slice(0);
  await reparsed.xlsx.load(arrayBuf);
  const reparsedSheet = reparsed.getWorksheet("报价单");
  assert(reparsedSheet !== undefined, "Re-parsed workbook contains '报价单' worksheet");

  if (reparsedSheet) {
    // Verify header info rows (rows 1-4)
    const customerCell = String(reparsedSheet.getCell(1, 1).value ?? "");
    assert(customerCell.includes("测试客户"), `Row 1 contains customer name (got "${customerCell}")`);

    const projectCell = String(reparsedSheet.getCell(2, 1).value ?? "");
    assert(projectCell.includes("测试项目"), `Row 2 contains project name (got "${projectCell}")`);

    const dateCell = String(reparsedSheet.getCell(3, 1).value ?? "");
    assert(dateCell.includes("2026-07-20"), `Row 3 contains quote date`);

    const vendorCell = String(reparsedSheet.getCell(4, 1).value ?? "");
    assert(vendorCell.includes("测试单位"), `Row 4 contains vendor name`);

    // Verify column headers row (row 6) contains trade labels
    const colHeadersRow = reparsedSheet.getRow(6);
    const colHeaderVal = String(colHeadersRow.getCell(1).value ?? "");
    assert(colHeaderVal === "序号", `Column header row [1] is '序号' (got "${colHeaderVal}")`);

    const tradeHeaderVal = String(colHeadersRow.getCell(7).value ?? "");
    assert(tradeHeaderVal === "前端开发", `Column header row [7] is '前端开发' trade label (got "${tradeHeaderVal}")`);

    const designHeaderVal = String(colHeadersRow.getCell(9).value ?? "");
    assert(designHeaderVal === "UI 设计", `Column header row [9] is 'UI 设计' trade label (got "${designHeaderVal}")`);

    const remarkHeaderVal = String(colHeadersRow.getCell(10).value ?? "");
    assert(remarkHeaderVal === "备注", `Column header row [10] is '备注' (got "${remarkHeaderVal}")`);

    // Verify data rows
    const firstDataRow = reparsedSheet.getRow(7);
    const seqVal = firstDataRow.getCell(1).value;
    assert(seqVal === 1, `First data row seq=1 (got ${String(seqVal)})`);

    const moduleCell = reparsedSheet.getCell(7, 2);
    assert(moduleCell.value === "系统设计", `Module cell value (got ${String(moduleCell.value)})`);

    // Verify trade values
    const backendVal = reparsedSheet.getCell(7, 8).value;
    assert(backendVal === 3, `Backend trade value (got ${String(backendVal)})`);

    // Verify null trade value becomes "-"
    const nullTradeCell = reparsedSheet.getCell(10, 8);
    assert(nullTradeCell.value === "-", `Null trade value rendered as '-' (got ${String(nullTradeCell.value)})`);

    // Verify empty remark becomes "-"
    const remarkCell = reparsedSheet.getCell(7, 10);
    assert(remarkCell.value === "-", `Empty remark rendered as '-' (got ${String(remarkCell.value)})`);

    // Verify non-empty remark
    const remarkCellReal = reparsedSheet.getCell(9, 10);
    assert(remarkCellReal.value === "详见原型", `Non-empty remark (got ${String(remarkCellReal.value)})`);

    // Verify merge logic: count merges
    const merges = (reparsedSheet as unknown as { _merges: Record<string, unknown> })._merges;
    const mergeCount = merges ? Object.keys(merges).length : 0;
    // Expected merges:
    //   col 2 (module): "系统设计" rows 7-8, "可视化大屏" rows 9-10 → 2 merges
    //   col 3 (sub_module): "运营看板" rows 9-10 → 1 merge
    //   col 4 (function): unique per row → 0 merges
    //   col 5 (sub_function): unique per row → 0 merges
    // Total expected: 3
    assert(mergeCount === 3, `Merge logic: expected 3 merges, got ${mergeCount}`);
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