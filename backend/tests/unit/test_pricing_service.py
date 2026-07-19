"""报价服务单元测试 — 目标价分配、组合方案、金额计算。"""

import pytest

from app.schemas.pricing import RoleConfig, WorkPackage, QuoteLine
from app.services.pricing_service import PricingService, calculate_totals


def test_current_config_returns_one_plan_when_target_is_reachable():
    service = PricingService()
    plans = service.build_plans(
        target_gross_cents=250_000,
        roles=[RoleConfig(name="产品", unit_price_cents=80_000, price_floor_cents=56_000, price_ceiling_cents=104_000, is_required=True)],
        work_packages=[WorkPackage(id="f1", name="功能1", role_names=["产品"], weight=5)],
    )
    assert len(plans) == 1
    assert plans[0].kind == "recommended"
    assert 242_500 <= plans[0].gross_cents <= 257_500


def test_unreachable_current_config_returns_at_most_three_adjusted_plans():
    service = PricingService()
    plans = service.build_plans(
        target_gross_cents=10_000_000,
        roles=[RoleConfig(name="产品", unit_price_cents=80_000, price_floor_cents=56_000, price_ceiling_cents=104_000, is_required=True)],
        work_packages=[WorkPackage(id="f1", name="功能1", role_names=["产品"], weight=1)],
    )
    assert 1 <= len(plans) <= 3
    assert all(plan.kind in {"recommended", "adjusted", "closest"} for plan in plans)
    # 至少有一个方案有调整说明
    assert any(plan.adjustments for plan in plans)


def test_money_and_half_day_units_are_integer_based():
    totals = calculate_totals([QuoteLine(role="产品", unit_price_cents=80_000, half_day_units=3)])
    assert totals.labor_cents == 120_000
    assert totals.tax_cents == 7_200
    assert totals.gross_cents == 127_200


def test_multiple_roles_and_packages_produces_correct_totals():
    lines = [
        QuoteLine(role="产品", unit_price_cents=80_000, half_day_units=2),
        QuoteLine(role="前端", unit_price_cents=85_000, half_day_units=3),
        QuoteLine(role="后端", unit_price_cents=85_000, half_day_units=4),
    ]
    totals = calculate_totals(lines)
    # 产品: 80000*2/2=80000, 前端: 85000*3/2=127500, 后端: 85000*4/2=170000
    # labor = 80000+127500+170000 = 377500
    # tax = (377500*6+50)//100 = 22650+1 = 22650... wait let me calculate
    # 377500*6 = 2265000, (2265000+50)//100 = 22650... +0.5 rounding => 22650
    # But wait: 377500*6 = 2265000. (2265000+50)/100 = 22650.5 => //100 = 22650
    # Actually integer division truncates: 2265050//100 = 22650
    assert totals.labor_cents == 377_500
    assert totals.tax_cents == 22_650
    assert totals.gross_cents == 400_150


def test_empty_lines_returns_zero():
    totals = calculate_totals([])
    assert totals.labor_cents == 0
    assert totals.tax_cents == 0
    assert totals.gross_cents == 0


def test_half_day_cost_formula():
    from app.services.pricing_service import half_day_cost
    assert half_day_cost(80_000, 1) == 40_000
    assert half_day_cost(80_000, 2) == 80_000
    assert half_day_cost(80_000, 3) == 120_000
    assert half_day_cost(85_000, 1) == 42_500
