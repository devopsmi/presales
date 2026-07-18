"""报价流程集成测试 — 定价、方案选择、项目阶段更新。"""

from datetime import date
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.project import Project  # noqa: F401
from app.models.generation_run import GenerationRun  # noqa: F401
from app.schemas.requirement import RequirementNode
from app.services.run_service import RunService


SQLALCHEMY_TEST_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(autouse=True)
def setup_database():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def db_session():
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(db_session):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def project_with_confirmed_draft(client, db_session):
    """创建一个已有确认需求快照的项目。"""
    resp = client.post(
        "/api/v1/projects",
        json={
            "project_type": "new",
            "target_price_wan": "30",
            "quote_company": "测试公司",
            "quote_date": "2026-07-17",
        },
    )
    proj = resp.json()

    # 创建一个 succeeded analysis run 并写入确认需求
    svc = RunService(db_session)
    run = svc.create_run(project_id=proj["id"], task_type="analysis")
    svc.start_run(run.id)
    svc.complete_run(run.id)
    run.confirmed_requirements = [
        RequirementNode(
            id="r1", module="客户管理", feature="登录", description="用户登录",
            source_refs=["brief.docx"], complexity_weight=2,
            suggested_roles=["后端"],
        ).model_dump(),
        RequirementNode(
            id="r2", module="客户管理", feature="权限", description="权限管理",
            source_refs=["brief.docx"], complexity_weight=3,
            suggested_roles=["后端", "前端"],
        ).model_dump(),
    ]
    db_session.commit()

    return proj


def test_pricing_run_returns_plan(client, project_with_confirmed_draft):
    proj = project_with_confirmed_draft
    resp = client.post(f"/api/v1/projects/{proj['id']}/pricing-runs")
    assert resp.status_code == 202
    run_id = resp.json()["run_id"]

    run = client.get(f"/api/v1/runs/{run_id}").json()
    assert run["status"] == "succeeded"
    assert run["pricing_payload"] is not None
    assert len(run["pricing_payload"]["plans"]) >= 1
    assert run["pricing_payload"]["plans"][0]["kind"] in {"recommended", "adjusted", "closest"}


def test_select_scenario_updates_project(client, project_with_confirmed_draft):
    proj = project_with_confirmed_draft
    resp = client.post(f"/api/v1/projects/{proj['id']}/pricing-runs")
    run = client.get(f"/api/v1/runs/{resp.json()['run_id']}").json()
    plan_id = run["pricing_payload"]["plans"][0]["id"]

    put = client.put(
        f"/api/v1/projects/{proj['id']}/selected-scenario",
        json={"run_id": run["id"], "scenario_id": plan_id},
    )
    assert put.status_code == 200
    updated = client.get(f"/api/v1/projects/{proj['id']}").json()
    assert updated["stage"] == "quote_ready"
    assert updated["selected_run_id"] == run["id"]
    assert updated["selected_scenario_id"] == plan_id


def test_pricing_run_fails_without_confirmed_requirements(client):
    resp = client.post(
        "/api/v1/projects",
        json={
            "project_type": "new",
            "target_price_wan": "30",
            "quote_company": "测试公司",
            "quote_date": "2026-07-17",
        },
    )
    proj = resp.json()
    resp = client.post(f"/api/v1/projects/{proj['id']}/pricing-runs")
    assert resp.status_code == 400
    assert "确认需求" in resp.text
