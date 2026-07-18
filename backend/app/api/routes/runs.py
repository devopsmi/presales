"""生成任务 API — 分析、确认需求、重试、历史。"""

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.project import Project
from app.models.generation_run import GenerationRun
from app.models.material import Material
from app.dependencies import get_agent_gateway
from app.schemas.run import RunCreate, RunResponse, RunListResponse
from app.schemas.requirement import ConfirmedRequirements
from app.schemas.project import ProjectStage
from app.schemas.pricing import SelectScenarioRequest
from app.services.run_service import RunService
from app.services.openai_agent import OpenAIAgent
from app.services.pricing_service import PricingService

router = APIRouter(tags=["runs"])


def _get_project(project_id: str, db: Session) -> Project:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    return project


@router.post("/projects/{project_id}/analysis-runs", status_code=202)
def start_analysis_run(
    project_id: str,
    body: RunCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    agent: OpenAIAgent = Depends(get_agent_gateway),
):
    project = _get_project(project_id, db)
    svc = RunService(db)
    run = svc.create_run(project_id=project_id, task_type="analysis")

    # Build blocks from materials
    materials = db.query(Material).filter(Material.project_id == project_id).all()
    blocks = [
        {"source": m.original_name, "priority": 2, "text": f"[file] {m.original_name}"}
        for m in materials
    ]
    if body.supplement:
        blocks.append({"source": "user_input", "priority": 1, "text": body.supplement})

    background_tasks.add_task(svc.run_analysis, run.id, agent, blocks, body.supplement)
    return {"run_id": run.id}


@router.get("/runs/{run_id}", response_model=RunResponse)
def get_run(run_id: str, db: Session = Depends(get_db)):
    svc = RunService(db)
    run = svc.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="任务不存在")
    return run


@router.post("/runs/{run_id}/retry", status_code=202)
def retry_run(
    run_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    agent: OpenAIAgent = Depends(get_agent_gateway),
):
    svc = RunService(db)
    old_run = svc.get_run(run_id)
    if not old_run:
        raise HTTPException(status_code=404, detail="任务不存在")

    # 创建新 run
    new_run = svc.create_run(project_id=old_run.project_id, task_type=old_run.task_type)
    blocks = []
    background_tasks.add_task(svc.run_analysis, new_run.id, agent, blocks, None)
    return {"run_id": new_run.id}


@router.put("/projects/{project_id}/confirmed-requirements")
def confirm_requirements(
    project_id: str,
    body: ConfirmedRequirements,
    db: Session = Depends(get_db),
):
    project = _get_project(project_id, db)

    # 将确认的需求保存到最近的 succeeded analysis run
    latest_run: GenerationRun | None = (
        db.query(GenerationRun)
        .filter(
            GenerationRun.project_id == project_id,
            GenerationRun.task_type == "analysis",
            GenerationRun.status == "succeeded",
        )
        .order_by(GenerationRun.created_at.desc())
        .first()
    )
    if latest_run:
        latest_run.confirmed_requirements = [r.model_dump() for r in body.requirements]
        db.commit()

    project.stage = ProjectStage.DRAFT_READY.value
    db.commit()
    db.refresh(project)
    return {"stage": project.stage}


@router.post("/projects/{project_id}/pricing-runs", status_code=202)
def start_pricing_run(
    project_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    project = _get_project(project_id, db)

    # 检查是否有确认需求
    latest_run: GenerationRun | None = (
        db.query(GenerationRun)
        .filter(
            GenerationRun.project_id == project_id,
            GenerationRun.task_type == "analysis",
            GenerationRun.status == "succeeded",
            GenerationRun.confirmed_requirements.isnot(None),
        )
        .order_by(GenerationRun.created_at.desc())
        .first()
    )
    if not latest_run:
        raise HTTPException(status_code=400, detail="请先确认需求快照")

    svc = RunService(db)
    run = svc.create_run(project_id=project_id, task_type="pricing")
    background_tasks.add_task(svc.run_pricing, run.id, project)
    return {"run_id": run.id}


@router.put("/projects/{project_id}/selected-scenario")
def select_scenario(
    project_id: str,
    body: SelectScenarioRequest,
    db: Session = Depends(get_db),
):
    project = _get_project(project_id, db)
    run = db.query(GenerationRun).filter(GenerationRun.id == body.run_id).first()
    if not run or run.project_id != project_id:
        raise HTTPException(status_code=404, detail="任务不存在")

    project.selected_run_id = body.run_id
    project.selected_scenario_id = body.scenario_id
    project.stage = ProjectStage.QUOTE_READY.value
    db.commit()
    db.refresh(project)
    return {
        "stage": project.stage,
        "selected_run_id": project.selected_run_id,
        "selected_scenario_id": project.selected_scenario_id,
    }


@router.get("/projects/{project_id}/runs", response_model=RunListResponse)
def list_runs(project_id: str, db: Session = Depends(get_db)):
    _get_project(project_id, db)
    svc = RunService(db)
    items = svc.get_runs(project_id)
    return RunListResponse(items=items, total=len(items))
