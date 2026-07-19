"""项目 API 路由 — 通过 ProjectService 操作。"""

import io
import re
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.project import ProjectCreate, ProjectListResponse, ProjectResponse, ProjectUpdate
from app.services.project_service import ProjectService
from app.services.quote_export_service import QuoteExportService

router = APIRouter()


def _project_to_response(project) -> ProjectResponse:
    return ProjectResponse(
        id=project.id,
        name=project.name,
        project_type=project.project_type,
        target_gross_cents=project.target_gross_cents,
        quote_company=project.quote_company,
        quote_date=project.quote_date,
        customer_name=project.customer_name,
        roles=project.roles_json,
        stage=project.stage,
        selected_run_id=project.selected_run_id,
        selected_scenario_id=project.selected_scenario_id,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


@router.post("", response_model=ProjectResponse, status_code=201)
def create_project(data: ProjectCreate, db: Session = Depends(get_db)):
    svc = ProjectService(db)
    try:
        project = svc.create(data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _project_to_response(project)


@router.get("", response_model=ProjectListResponse)
def list_projects(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    svc = ProjectService(db)
    items, total = svc.list(page, page_size)
    return ProjectListResponse(
        items=[_project_to_response(p) for p in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(project_id: str, db: Session = Depends(get_db)):
    svc = ProjectService(db)
    project = svc.get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    return _project_to_response(project)


@router.patch("/{project_id}", response_model=ProjectResponse)
def update_project(project_id: str, data: ProjectUpdate, db: Session = Depends(get_db)):
    if data.stage is not None:
        raise HTTPException(status_code=422, detail="stage 不可通过此接口修改")
    svc = ProjectService(db)
    project = svc.update(project_id, data)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    return _project_to_response(project)


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: str, db: Session = Depends(get_db)):
    svc = ProjectService(db)
    if not svc.delete(project_id):
        raise HTTPException(status_code=404, detail="项目不存在")


@router.get("/{project_id}/export-quote")
def export_quote(project_id: str, db: Session = Depends(get_db)):
    """导出已选方案的报价单为 Excel 文件。"""
    # 先获取项目名称用于文件名
    proj_svc = ProjectService(db)
    project = proj_svc.get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    svc = QuoteExportService(db)
    try:
        excel_bytes = svc.export_selected_plan(project_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    name_part = project.name or project_id[:8]
    ascii_name = re.sub(r'[^\x00-\x7F]', '_', name_part)  # 中文替换为下划线
    filename = f"quote_{ascii_name}.xlsx"
    # RFC 5987 编码中文文件名用于 Content-Disposition
    encoded_name = quote(name_part.encode('utf-8'))
    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename=\"{filename}\"; filename*=UTF-8''{encoded_name}",
        },
    )