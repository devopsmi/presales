"""4-phase pricing algorithm unit tests."""

import pytest
from app.schemas.pricing import RoleConfig, WorkPackage
from app.services.pricing_service import PricingService, half_day_cost


def test_phase1_baseline_hits_target():
    """Phase 1: 基准分配 (1个半天) 就命中目标。"""
    svc = PricingService()
    plans = svc.build_plans(
        target_gross_cents=42_400,
        roles=[RoleConfig(name="产品", unit_price_cents=80_000, is_required=True)],
        work_packages=[WorkPackage(id="f1", name="功能1", role_names=["产品"], weight=1)],
    )
    assert len(plans) == 1
    assert plans[0].kind == "recommended"
    assert plans[0].within_target


def test_phase2_hours_adjustment_reaches_target():
    """Phase 2: 需要增加半天数才能命中目标。"""
    svc = PricingService()
    plans = svc.build_plans(
        target_gross_cents=250_000,
        roles=[RoleConfig(name="产品", unit_price_cents=80_000, is_required=True)],
        work_packages=[WorkPackage(id="f1", name="功能1", role_names=["产品"], weight=5)],
    )
    assert len(plans) == 1
    p = plans[0]
    assert p.within_target
    # 应分配了多个半天
    total_units = sum(line.half_day_units for line in p.lines)
    assert total_units > 1


def test_phase2_respects_weight_based_max():
    """Phase 2 工时上限 = 4 + weight（半天）。"""
    svc = PricingService()
    plans = svc.build_plans(
        target_gross_cents=10_000_000,
        roles=[RoleConfig(name="产品", unit_price_cents=80_000, is_required=True)],
        work_packages=[WorkPackage(id="f1", name="功能1", role_names=["产品"], weight=1)],
    )
    p = plans[0]
    for line in p.lines:
        assert line.half_day_units <= 5  # 4 + 1×1 = 5 for weight=1
        assert line.unit_price_cents <= 104_000  # ceiling


def test_phase3_price_float_hits_target():
    """Phase 3: 工时已满, 价格浮动 ±30% 命中目标."""
    svc = PricingService()
    # weight=1 → 最多 5 个半天, 基准 80_000 → max labor=200_000, gross≈212_000
    # 目标 240_000 需要价格上浮才能达到
    plans = svc.build_plans(
        target_gross_cents=240_000,
        roles=[RoleConfig(name="产品", unit_price_cents=80_000, price_floor_cents=56_000, price_ceiling_cents=104_000, is_required=True)],
        work_packages=[WorkPackage(id="f1", name="功能1", role_names=["产品"], weight=1)],
    )
    assert len(plans) >= 1
    p = plans[0]
    assert p.within_target, f"gross={p.gross_cents} target=240000"
    # 应命中目标（通过价格上浮或工时调满）


def test_phase3_respects_price_ceiling():
    """Phase 3: 价格不超 ceiling。"""
    svc = PricingService()
    plans = svc.build_plans(
        target_gross_cents=10_000_000,
        roles=[RoleConfig(name="产品", unit_price_cents=80_000, price_floor_cents=56_000, price_ceiling_cents=104_000, is_required=True)],
        work_packages=[WorkPackage(id="f1", name="功能1", role_names=["产品"], weight=5)],
    )
    for plan in plans:
        for line in plan.lines:
            assert line.unit_price_cents <= 104_000


def test_multiple_roles_phase3_distribution():
    """多个角色时，Phase 3 能合理分配价格涨幅。"""
    svc = PricingService()
    plans = svc.build_plans(
        target_gross_cents=500_000,
        roles=[
            RoleConfig(name="产品", unit_price_cents=80_000, price_ceiling_cents=104_000, is_required=True),
            RoleConfig(name="后端", unit_price_cents=85_000, price_ceiling_cents=110_500, is_required=True),
        ],
        work_packages=[WorkPackage(id="f1", name="功能1", role_names=["产品", "后端"], weight=3)],
    )
    assert len(plans) >= 1
    # 应该至少有一个达标方案
    assert plans[0].within_target


def test_phase3_no_lower_than_floor():
    """Phase 3: 价格不低于 floor（当前算法只上浮不下调）。"""
    svc = PricingService()
    plans = svc.build_plans(
        target_gross_cents=100_000,
        roles=[RoleConfig(name="产品", unit_price_cents=80_000, price_floor_cents=56_000, price_ceiling_cents=104_000, is_required=True)],
        work_packages=[WorkPackage(id="f1", name="功能1", role_names=["产品"], weight=1)],
    )
    for plan in plans:
        for line in plan.lines:
            assert line.unit_price_cents >= 56_000
