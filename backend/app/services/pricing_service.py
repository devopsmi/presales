"""定价服务 — 四阶段递进分配：工时 → 价格浮动 → 自动拆分。"""

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


def _split_wp(wp: WorkPackage) -> list[WorkPackage]:
    """将工作包一分为二，按比例分配 weight。"""
    w1 = max(1, wp.weight // 2)
    w2 = wp.weight - w1
    return [
        WorkPackage(id=f"{wp.id}_s1", name=f"{wp.name}/2", role_names=wp.role_names.copy(), weight=w1),
        WorkPackage(id=f"{wp.id}_s2", name=f"{wp.name}/2", role_names=wp.role_names.copy(), weight=w2),
    ]


def _max_units_for_weight(weight: int) -> int:
    """工时上限 = 4 + weight（半天单位）。weight=1→5, weight=5→9。"""
    return 4 + weight * 1


class PricingService:
    """定价服务 — 四阶段递进分配算法。"""

    def build_plans(
        self,
        target_gross_cents: int,
        roles: list[RoleConfig],
        work_packages: list[WorkPackage],
    ) -> list[QuotePlan]:
        """四阶段入口：baseline → hours → price → split."""

        # ── Phase 1+2: 基线分配 + 工时调整 ──
        plan = self._allocate(target_gross_cents, roles, work_packages)
        if plan and plan.within_target:
            return [plan]

        # ── Phase 3: 价格浮动 ──
        if plan:
            plan = self._phase3_adjust_prices(plan, target_gross_cents, roles)
            if plan.within_target:
                return [plan]

        # ── Phase 4: 自动拆分 + 重分配 ──
        current_wps = list(work_packages)
        best_plan = plan

        for _round in range(5):
            current_wps.sort(key=lambda wp: wp.weight, reverse=True)
            if not current_wps or current_wps[0].weight <= 1:
                break

            to_split = current_wps.pop(0)
            current_wps.extend(_split_wp(to_split))

            new_plan = self._allocate(target_gross_cents, roles, current_wps)
            if new_plan:
                new_plan = self._phase3_adjust_prices(new_plan, target_gross_cents, roles)
                adj = f"自动拆分: {to_split.name}"
                if adj not in new_plan.adjustments:
                    new_plan.adjustments.append(adj)
                if new_plan.within_target:
                    return [new_plan]
                if best_plan is None or abs(new_plan.gross_cents - target_gross_cents) < abs(
                    best_plan.gross_cents - target_gross_cents
                ):
                    best_plan = new_plan

        return [best_plan] if best_plan else []

    # ------------------------------------------------------------------
    # Phase 1+2: 核心分配（基线 + 贪心工时调整）
    # ------------------------------------------------------------------

    def _allocate(
        self,
        target_gross_cents: int,
        roles: list[RoleConfig],
        work_packages: list[WorkPackage],
        price_overrides: dict[str, int] | None = None,
    ) -> QuotePlan | None:
        """在给定单价下执行分配。"""
        role_map = {r.name: r for r in roles}
        wp_map = {wp.id: wp for wp in work_packages or []}

        def _price(role_name: str) -> int:
            if price_overrides and role_name in price_overrides:
                return price_overrides[role_name]
            r = role_map.get(role_name)
            return r.unit_price_cents if r else 0

        lines: list[QuoteLine] = []
        for wp in work_packages or []:
            for role_name in wp.role_names:
                if role_name not in role_map:
                    continue
                lines.append(QuoteLine(
                    work_package_id=wp.id,
                    work_package_name=wp.name,
                    role=role_name,
                    unit_price_cents=_price(role_name),
                    half_day_units=1,
                ))

        if not lines:
            return None

        totals = calculate_totals(lines)

        # 贪心递增每个 (role, wp) 对的半天数
        for _ in range(100):
            if within_target(totals.gross_cents, target_gross_cents):
                break
            if totals.gross_cents >= target_gross_cents:
                break

            best_idx = -1
            best_gap = float("inf")
            for i, ln in enumerate(lines):
                wp = wp_map.get(ln.work_package_id or "")
                weight = wp.weight if wp else 1
                if ln.half_day_units >= _max_units_for_weight(weight):
                    continue
                new_units = ln.half_day_units + 1
                new_cost = half_day_cost(ln.unit_price_cents, new_units)
                old_cost = half_day_cost(ln.unit_price_cents, ln.half_day_units)
                new_gross = totals.gross_cents + (new_cost - old_cost)
                gap = abs(new_gross - target_gross_cents)
                if gap < best_gap and new_gross <= int(target_gross_cents * 1.03):
                    best_gap = gap
                    best_idx = i

            if best_idx == -1:
                break

            lines[best_idx].half_day_units += 1
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

    # ------------------------------------------------------------------
    # Phase 3: 价格浮动
    # ------------------------------------------------------------------

    def _phase3_adjust_prices(
        self,
        plan: QuotePlan,
        target_gross_cents: int,
        roles: list[RoleConfig],
    ) -> QuotePlan:
        """在 [floor, ceiling] 范围内微调角色单价以命中目标。"""
        role_map = {r.name: r for r in roles}

        # 当前各角色的实时价格
        current_prices: dict[str, int] = {}
        for ln in plan.lines:
            if ln.role not in current_prices:
                r = role_map.get(ln.role)
                current_prices[ln.role] = r.unit_price_cents if r else ln.unit_price_cents

        for _ in range(50):
            if within_target(plan.gross_cents, target_gross_cents):
                plan.within_target = True
                plan.kind = "recommended"
                if not plan.adjustments or "单价" not in plan.adjustments[-1]:
                    plan.adjustments.append("根据目标价上浮了角色单价")
                return plan

            best_role: str | None = None
            best_gap = float("inf")

            for role_name, cur_price in current_prices.items():
                r = role_map.get(role_name)
                if not r:
                    continue
                if cur_price >= r.price_ceiling_cents:
                    continue
                new_price = min(cur_price + 5000, r.price_ceiling_cents)
                delta = 0
                for ln in plan.lines:
                    if ln.role == role_name:
                        delta += half_day_cost(new_price, ln.half_day_units) - half_day_cost(cur_price, ln.half_day_units)
                new_gross = plan.gross_cents + delta
                gap = abs(new_gross - target_gross_cents)
                if gap < best_gap:
                    best_gap = gap
                    best_role = role_name

            if best_role is None:
                break

            old_price = current_prices[best_role]
            new_price = min(old_price + 5000, role_map[best_role].price_ceiling_cents)
            current_prices[best_role] = new_price
            for ln in plan.lines:
                if ln.role == best_role:
                    ln.unit_price_cents = new_price

            totals = calculate_totals(plan.lines)
            plan.labor_cents = totals.labor_cents
            plan.tax_cents = totals.tax_cents
            plan.gross_cents = totals.gross_cents

        if not any("单价" in a for a in plan.adjustments):
            plan.adjustments.append("价格调整后仍未命中目标价区间")
        return plan
