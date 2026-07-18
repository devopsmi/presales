"""报价 Pydantic schemas — WorkPackage / QuoteLine / QuotePlan / 金额计算工具。"""

from typing import Literal

from pydantic import BaseModel, Field


class RoleConfig(BaseModel):
    name: str
    unit_price_cents: int = Field(gt=0)
    is_required: bool = False


class WorkPackage(BaseModel):
    """工作包 — 从确认需求转换而来。"""
    id: str
    name: str
    role_names: list[str] = Field(min_length=1)
    weight: int = Field(ge=1, le=5)


class QuoteLine(BaseModel):
    """报价明细行 — 一个角色在一个工作包中的分配。"""
    work_package_id: str | None = None
    work_package_name: str | None = None
    role: str
    unit_price_cents: int
    half_day_units: int = Field(ge=1, le=6)


class QuotePlan(BaseModel):
    """报价方案 — 包含所有明细行和汇总金额。"""
    id: str
    kind: Literal["recommended", "adjusted", "closest"]
    lines: list[QuoteLine]
    labor_cents: int
    tax_cents: int
    gross_cents: int
    within_target: bool
    adjustments: list[str] = Field(default_factory=list)


class QuoteTotals(BaseModel):
    """报价汇总 — 人工费、税费、合计。"""
    labor_cents: int
    tax_cents: int
    gross_cents: int


class PricingPayload(BaseModel):
    """定价任务负载。"""
    target_gross_cents: int
    plans: list[QuotePlan]


class SelectScenarioRequest(BaseModel):
    run_id: str
    scenario_id: str
