"""定价服务 — 目标价分配、组合方案生成、确定性金额计算。"""

import uuid

from app.schemas.pricing import (
    QuotePlan,
    QuoteLine,
    QuoteTotals,
    RoleConfig,
    WorkPackage,
)


def half_day_cost(unit_price_cents: int, units: int) -> int:
    """计算半天成本：单价×半天数/2，四舍五入取整。"""
    return (unit_price_cents * units + 1) // 2


def calculate_totals(lines: list[QuoteLine]) -> QuoteTotals:
    """计算报价汇总。"""
    labor = sum(half_day_cost(line.unit_price_cents, line.half_day_units) for line in lines)
    tax = (labor * 6 + 50) // 100  # 四舍五入到分
    return QuoteTotals(labor_cents=labor, tax_cents=tax, gross_cents=labor + tax)


def within_target(gross_cents: int, target_gross_cents: int) -> bool:
    """检查是否在目标价的 97%-103% 区间内。"""
    return target_gross_cents * 97 <= gross_cents * 100 <= target_gross_cents * 103


class PricingService:
    """定价服务 — 实现分配算法和组合方案生成。"""

    def build_plans(
        self,
        target_gross_cents: int,
        roles: list[RoleConfig],
        work_packages: list[WorkPackage],
    ) -> list[QuotePlan]:
        """构建报价方案。

        若当前配置可行 → 返回 1 个推荐方案。
        不可行 → 返回最多 3 个调整方案。
        """
        recommended = self._allocate_current_config(target_gross_cents, roles, work_packages)
        if recommended and recommended.within_target:
            return [recommended]

        plans: list[QuotePlan] = []
        if recommended:
            recommended.kind = "closest"
            recommended.id = str(uuid.uuid4())
            recommended.adjustments.append("当前配置无法命中目标价区间")
            plans.append(recommended)

        # 生成调整方案
        candidates = [
            self._adjust_days_and_uniform_rate(target_gross_cents, roles, work_packages),
            self._closest_valid_allocation(target_gross_cents, roles, work_packages),
        ]
        plans.extend(p for p in candidates if p is not None)

        # 排序：先目标内，再调整数少，最后离目标近
        plans.sort(key=lambda p: (
            not p.within_target,
            len(p.adjustments),
            abs(p.gross_cents - target_gross_cents),
        ))
        return plans[:3]

    def _allocate_current_config(
        self,
        target_gross_cents: int,
        roles: list[RoleConfig],
        work_packages: list[WorkPackage],
    ) -> QuotePlan | None:
        """使用当前角色和单价进行分配。"""
        role_map = {r.name: r for r in roles}
        lines: list[QuoteLine] = []

        for wp in work_packages:
            for role_name in wp.role_names:
                role = role_map.get(role_name)
                if not role:
                    continue
                lines.append(QuoteLine(
                    work_package_id=wp.id,
                    work_package_name=wp.name,
                    role=role_name,
                    unit_price_cents=role.unit_price_cents,
                    half_day_units=1,  # 从 1 开始
                ))

        if not lines:
            return None

        # 贪心分配：按权重循环增加半天单位
        totals = calculate_totals(lines)
        max_iterations = 50
        for _ in range(max_iterations):
            if within_target(totals.gross_cents, target_gross_cents):
                break
            if totals.gross_cents >= target_gross_cents:
                break

            best_idx = -1
            best_gap = float("inf")
            for i, line in enumerate(lines):
                if line.half_day_units >= 6:
                    continue
                new_units = line.half_day_units + 1
                new_cost = half_day_cost(line.unit_price_cents, new_units)
                old_cost = half_day_cost(line.unit_price_cents, line.half_day_units)
                delta = new_cost - old_cost
                new_gross = totals.gross_cents + delta
                gap = abs(new_gross - target_gross_cents)
                if gap < best_gap and new_gross <= int(target_gross_cents * 1.03):
                    best_gap = gap
                    best_idx = i

            if best_idx == -1:
                break

            line = lines[best_idx]
            line.half_day_units += 1
            totals = calculate_totals(lines)

        return QuotePlan(
            id=str(uuid.uuid4()),
            kind="recommended" if within_target(totals.gross_cents, target_gross_cents) else "closest",
            lines=lines,
            labor_cents=totals.labor_cents,
            tax_cents=totals.tax_cents,
            gross_cents=totals.gross_cents,
            within_target=within_target(totals.gross_cents, target_gross_cents),
            adjustments=[],
        )

    def _adjust_days_and_uniform_rate(
        self,
        target_gross_cents: int,
        roles: list[RoleConfig],
        work_packages: list[WorkPackage],
    ) -> QuotePlan | None:
        """方案1：调整工时 + 统一调价。"""
        plan = self._allocate_current_config(int(target_gross_cents * 0.85), roles, work_packages)
        if not plan:
            return None

        # 如果当前价差大，按比例调整单价
        current = plan.gross_cents
        if current > 0 and not within_target(current, target_gross_cents):
            ratio = target_gross_cents / current
            for line in plan.lines:
                line.unit_price_cents = max(10_000, int(line.unit_price_cents * ratio / 1000) * 1000)
            totals = calculate_totals(plan.lines)
            plan.labor_cents = totals.labor_cents
            plan.tax_cents = totals.tax_cents
            plan.gross_cents = totals.gross_cents
            plan.within_target = within_target(totals.gross_cents, target_gross_cents)
            plan.adjustments.append("按目标价比例统一调整了角色单价")

        plan.kind = "adjusted"
        plan.id = str(uuid.uuid4())
        return plan

    def _closest_valid_allocation(
        self,
        target_gross_cents: int,
        roles: list[RoleConfig],
        work_packages: list[WorkPackage],
    ) -> QuotePlan | None:
        """方案2：最接近目标的有效分配。"""
        plan = self._allocate_current_config(target_gross_cents, roles, work_packages)
        if plan:
            plan.kind = "closest"
            plan.id = str(uuid.uuid4())
            plan.adjustments.append("当前配置无法命中目标价区间，返回最接近的分配方案")
        return plan
