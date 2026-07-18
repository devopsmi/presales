"""Phase 4 auto-split tests."""

import pytest
from app.schemas.pricing import RoleConfig, WorkPackage
from app.services.pricing_service import PricingService


def test_phase4_split_creates_sub_wps():
    """Phase 4: 预算超大时自动拆分子功能。"""
    svc = PricingService()
    # 1 wp × 1 role × weight=5 → max 7 半天 at ceiling=104_000
    # labor = ceil(104000*7/2) = 364000, gross ≈ 385840
    # 目标 1,000,000 → 必须拆分
    plans = svc.build_plans(
        target_gross_cents=1_000_000,
        roles=[RoleConfig(name="产品", unit_price_cents=80_000, price_floor_cents=56_000, price_ceiling_cents=104_000, is_required=True)],
        work_packages=[WorkPackage(id="f1", name="知识管理·文档上传", role_names=["产品"], weight=5)],
    )
    assert len(plans) >= 1
    p = plans[0]
    assert p.within_target, f"gross={p.gross_cents} target=1000000"
    # 应有拆分提示
    assert any("拆分" in a for a in p.adjustments)


def test_phase4_multiple_splits():
    """Phase 4: 多轮拆分直到命中目标或达到轮次上限。"""
    svc = PricingService()
    # 1 wp × 1 role × weight=5 → 拆分5轮后5个子WP, 各最多5半天 at ceiling=104K
    # max gross ≈ 1,378,000. 目标 1,200,000 可通过 Phase 3 调价达到。
    plans = svc.build_plans(
        target_gross_cents=1_200_000,
        roles=[RoleConfig(name="产品", unit_price_cents=80_000, price_ceiling_cents=104_000, is_required=True)],
        work_packages=[WorkPackage(id="f1", name="知识管理·文档上传", role_names=["产品"], weight=5)],
    )
    assert len(plans) >= 1
    p = plans[0]
    assert p.within_target, f"gross={p.gross_cents} target=1200000"


def test_phase4_split_limits_at_five_rounds():
    """Phase 4: 最多 5 轮拆分，返回最佳方案。"""
    svc = PricingService()
    plans = svc.build_plans(
        target_gross_cents=100_000_000,
        roles=[RoleConfig(name="产品", unit_price_cents=80_000, price_ceiling_cents=104_000, is_required=True)],
        work_packages=[WorkPackage(id="f1", name="知识管理·文档上传", role_names=["产品"], weight=5)],
    )
    assert len(plans) >= 1
    assert plans[0].gross_cents > 0
    # 应有拆分提示
    assert any("拆分" in a for a in plans[0].adjustments)


def test_phase4_multiple_roles_trigger_split():
    """多个角色时拆分行为正常。"""
    svc = PricingService()
    plans = svc.build_plans(
        target_gross_cents=2_000_000,
        roles=[
            RoleConfig(name="产品", unit_price_cents=80_000, price_ceiling_cents=104_000, is_required=True),
            RoleConfig(name="后端", unit_price_cents=85_000, price_ceiling_cents=110_500, is_required=True),
            RoleConfig(name="测试", unit_price_cents=70_000, price_ceiling_cents=91_000, is_required=False),
        ],
        work_packages=[WorkPackage(id="f1", name="功能A", role_names=["产品", "后端", "测试"], weight=5)],
    )
    assert len(plans) >= 1
    p = plans[0]
    assert p.within_target, f"gross={p.gross_cents} target=2000000"
    # 应该有多个 lines（因为拆分产生了多个子 WP）
    assert len(p.lines) >= 3
