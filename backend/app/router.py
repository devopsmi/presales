"""
API 路由

POST /generate     - 方案生成
POST /export/design    - 导出设计方案为 Word
POST /export/estimate  - 导出报价单为 Excel
"""

import json
import logging
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from app.config import settings
from app.exporter.word_exporter import WordExporter
from app.exporter.excel_exporter import ExcelExporter
from app.formatter import Formatter
from app.parser.document_parser import DocumentParser
from app.schemas import GenerateResponse, EstimateResult, EstimateTask, Summary
from app.workflow import WorkflowController

logger = logging.getLogger(__name__)

router = APIRouter()
workflow = WorkflowController()


@router.post("/generate", response_model=GenerateResponse)
async def generate(
    requirement: str = Form(..., min_length=1, description="需求描述文本"),
    file: UploadFile | None = File(None, description="参考文档（支持 pdf/docx/xlsx/txt）"),
    company_name: str = Form(default="", description="客户名称"),
    project_name: str = Form(default="", description="项目名称"),
    quotation_unit: str = Form(default="", description="报价单位"),
    max_budget: float = Form(default=0, description="最高预算上限（0不限制）"),
    roles: str = Form(default="", description="可用岗位列表（JSON数组）"),
) -> GenerateResponse:
    """接收需求文本和可选参考文档，执行方案生成 Pipeline。"""
    if file and file.size and file.size > settings.max_file_size_mb * 1024 * 1024:
        raise HTTPException(
            status_code=400,
            detail=f"文件大小超过限制（最大 {settings.max_file_size_mb}MB）",
        )

    doc_text = ""
    if file and file.filename:
        suffix = Path(file.filename).suffix.lower()
        if suffix not in (".pdf", ".docx", ".xlsx", ".txt"):
            raise HTTPException(
                status_code=400,
                detail=f"不支持的文档格式: {suffix}，仅支持 .pdf / .docx / .xlsx / .txt",
            )
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                content = await file.read()
                tmp.write(content)
                tmp_path = tmp.name
            doc_text = await DocumentParser.parse(tmp_path)
            Path(tmp_path).unlink(missing_ok=True)
            logger.info("文档解析完成，长度: %d 字符", len(doc_text))
        except Exception as e:
            logger.error("文档解析失败: %s", e)
            raise HTTPException(status_code=422, detail=f"文档解析失败: {e!s}")

    roles_list: list[str] = json.loads(roles) if roles else ["后端工程师", "前端工程师", "测试工程师"]

    try:
        context = await workflow.run(
            requirement,
            doc_text,
            company_name=company_name,
            project_name=project_name,
            quotation_unit=quotation_unit,
            max_budget=max_budget,
            roles=roles_list,
        )
    except Exception as e:
        logger.error("方案生成失败: %s", e)
        raise HTTPException(status_code=500, detail=f"处理失败: {e!s}")

    try:
        response = Formatter.format(context)
    except Exception as e:
        logger.error("结果格式化失败: %s", e)
        raise HTTPException(status_code=500, detail=f"结果处理失败: {e!s}")

    return response


@router.post("/export/design")
async def export_design(
    markdown: str = Form(..., description="设计方案 Markdown 内容"),
) -> StreamingResponse:
    """导出设计方案为 Word 文档。"""
    try:
        buf = WordExporter.export(markdown)
        filename = "design_document.docx"
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )
    except Exception as e:
        logger.exception("Word 导出失败")
        raise HTTPException(status_code=500, detail=f"导出失败: {e!s}")


@router.post("/export/estimate")
async def export_estimate(
    tasks: str = Form(..., description="任务清单 JSON 字符串"),
    summary: str = Form(..., description="汇总 JSON 字符串"),
    company_name: str = Form(default="", description="客户名称"),
    project_name: str = Form(default="", description="项目名称"),
    quotation_unit: str = Form(default="", description="报价单位"),
) -> StreamingResponse:
    """导出报价单为 Excel 文件。"""
    try:
        tasks_data = json.loads(tasks)
        summary_data = json.loads(summary)
        estimate_result = EstimateResult(
            tasks=[EstimateTask(**t) for t in tasks_data],
            summary=Summary(**summary_data),
        )
        buf = ExcelExporter.export(
            estimate_result,
            company_name=company_name,
            project_name=project_name,
            quotation_unit=quotation_unit,
        )
        filename = "quotation.xlsx"
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )
    except Exception as e:
        logger.exception("Excel 导出失败")
        raise HTTPException(status_code=500, detail=f"导出失败: {e!s}")
