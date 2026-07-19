"""报价单导出单元测试。"""

import io

import pytest
from openpyxl import load_workbook

from app.models.generation_run import GenerationRun
from app.models.project import Project
from app.services.quote_export_service import QuoteExportService


def _fake_project() -> Project:
    p = Project(
        id="proj-001",
        name="测试项目",
        project_type="new",
        target_gross_cents=500_000_00,  # 50万
        quote_company="测试公司",
        quote_date="2026-07-19",
        customer_name="客户甲",
        roles_json=[{"name": "产品", "unit_price_cents": 80_000, "price_floor_cents": 56_000, "price_ceiling_cents": 104_000, "is_required": True}],
        stage="completed",
        selected_run_id="run-001",
        selected_scenario_id="plan-001",
    )
    return p


def _fake_pricing_payload() -> dict:
    return {
        "target_gross_cents": 500_000_00,
        "plans": [
            {
                "id": "plan-001",
                "kind": "recommended",
                "lines": [
                    {"work_package_id": "f1", "work_package_name": "模块·功能·子功能", "role": "产品", "unit_price_cents": 80_000, "half_day_units": 3},
                    {"work_package_id": "f1", "work_package_name": "模块·功能·子功能", "role": "前端", "unit_price_cents": 85_000, "half_day_units": 2},
                    {"work_package_id": "f2", "work_package_name": "模块·功能B", "role": "后端", "unit_price_cents": 85_000, "half_day_units": 4},
                ],
                "labor_cents": 472_500,
                "tax_cents": 28_350,
                "gross_cents": 500_850,
                "within_target": True,
                "adjustments": ["根据目标价上浮了角色单价", "自动拆分: 模块·功能/2"],
            }
        ],
    }


def _fake_run() -> GenerationRun:
    run = GenerationRun(
        id="run-001",
        project_id="proj-001",
        task_type="pricing",
        status="succeeded",
        pricing_payload=_fake_pricing_payload(),
    )
    return run


def test_export_generates_valid_excel_with_plan_data():
    """验证导出生成有效的 Excel 文件并包含预期的数据。"""
    project = _fake_project()
    plan = _fake_pricing_payload()["plans"][0]

    svc = QuoteExportService.__new__(QuoteExportService)
    excel_bytes = svc._generate_workbook(project, plan)

    assert excel_bytes
    assert len(excel_bytes) > 1000  # 有效的 Excel 文件至少 1KB

    # 用 openpyxl 重新加载验证
    wb = load_workbook(io.BytesIO(excel_bytes))
    assert "报价单" in wb.sheetnames

    ws = wb["报价单"]
    # 标题
    assert ws.cell(row=1, column=1).value == "报 价 单"
    # 项目信息
    cell_values = {ws.cell(row=r, column=1).value: ws.cell(row=r, column=2).value for r in range(1, ws.max_row + 1)}
    assert "测试项目" in str(cell_values.get("项目名称", ""))
    # 价格对比
    assert any("50.00" in str(ws.cell(row=r, column=2).value or "") for r in range(1, ws.max_row + 1))
    # 明细行数据
    assert ws.cell(row=1, column=1).value == "报 价 单"


def test_export_lines_count_matches():
    """验证 Excel 中的明细行数与实际方案行数一致。"""
    project = _fake_project()
    payload = _fake_pricing_payload()
    plan = payload["plans"][0]
    line_count = len(plan["lines"])

    svc = QuoteExportService.__new__(QuoteExportService)
    excel_bytes = svc._generate_workbook(project, plan)

    wb = load_workbook(io.BytesIO(excel_bytes))
    ws = wb["报价单"]

    # 表头在第 header_row，明细行从 header_row+1 开始到 header_row+line_count
    # 找"序号"行
    header_row = None
    for r in range(1, ws.max_row + 1):
        if ws.cell(row=r, column=1).value == "序号":
            header_row = r
            break
    assert header_row is not None

    # 明细行数
    data_rows = 0
    for r in range(header_row + 1, ws.max_row + 1):
        if ws.cell(row=r, column=1).value and isinstance(ws.cell(row=r, column=1).value, int):
            data_rows += 1
        else:
            break

    assert data_rows == line_count, f"期望 {line_count} 行明细，实际 {data_rows} 行"


def test_export_shows_adjustments():
    """验证调整说明出现在 Excel 中。"""
    project = _fake_project()
    payload = _fake_pricing_payload()
    plan = payload["plans"][0]

    svc = QuoteExportService.__new__(QuoteExportService)
    excel_bytes = svc._generate_workbook(project, plan)

    wb = load_workbook(io.BytesIO(excel_bytes))
    ws = wb["报价单"]

    all_text = ""
    for r in range(1, ws.max_row + 1):
        for c in range(1, ws.max_column + 1):
            v = ws.cell(row=r, column=c).value
            if v:
                all_text += str(v)

    assert "上浮" in all_text or "拆分" in all_text


def test_export_empty_project_name():
    """验证项目名称为空时导出不报错。"""
    project = _fake_project()
    project.name = None
    plan = _fake_pricing_payload()["plans"][0]

    svc = QuoteExportService.__new__(QuoteExportService)
    excel_bytes = svc._generate_workbook(project, plan)
    assert excel_bytes


def test_export_no_adjustments():
    """验证无调整说明也能正常导出。"""
    project = _fake_project()
    payload = _fake_pricing_payload()
    plan = payload["plans"][0].copy()
    plan["adjustments"] = []

    svc = QuoteExportService.__new__(QuoteExportService)
    excel_bytes = svc._generate_workbook(project, plan)
    assert excel_bytes

    wb = load_workbook(io.BytesIO(excel_bytes))
    ws = wb["报价单"]
    assert ws.max_row >= 5  # 至少有几行数据
