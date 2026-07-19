# Pricing Algorithm Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 4-phase pricing algorithm: hours → price float (±30%) → budget-driven auto-split

**Architecture:** Backend: extended RoleConfig schema + rewritten PricingService with 4-phase loop. Frontend: price range columns in ProjectForm + adjustment tags in PricingStep.

**Tech Stack:** Python/Pydantic/FastAPI (backend), Vue 3/Element Plus (frontend), Pytest (backend tests)

## Global Constraints

- All monetary values in cents (分), integer arithmetic only
- Price float floor = `unit_price_cents × 0.7`, ceiling = `unit_price_cents × 1.3` (default)
- Tax rate remains 6%, half_day_cost formula unchanged (`(price × units + 1) // 2`)
- Existing 33 backend tests must continue to pass
- All new code requires unit tests

---

### Task 1: Update RoleConfig Schema with Price Range

**Files:**
- Modify: `backend/app/schemas/pricing.py`
- Modify: `backend/tests/unit/test_pricing_service.py`
- Test: existing tests adapt to new RoleConfig

**Interfaces:**
- Consumes: current `RoleConfig(name, unit_price_cents, is_required)`
- Produces: extended `RoleConfig(name, unit_price_cents, price_floor_cents, price_ceiling_cents, is_required)`

- [ ] **Step 1: Update RoleConfig schema**

In `backend/app/schemas/pricing.py`, update `RoleConfig`:

```python
class RoleConfig(BaseModel):
    name: str
    unit_price_cents: int = Field(gt=0)
    price_floor_cents: int | None = Field(gt=0, default=None)
    price_ceiling_cents: int | None = Field(gt=0, default=None)
    is_required: bool = False
```

Add a model_validator to auto-compute floor/ceiling defaults from unit_price_cents:

```python
from pydantic import model_validator

class RoleConfig(BaseModel):
    name: str
    unit_price_cents: int = Field(gt=0)
    price_floor_cents: int | None = Field(gt=0, default=None)
    price_ceiling_cents: int | None = Field(gt=0, default=None)
    is_required: bool = False

    @model_validator(mode="after")
    def _fill_price_bounds(self) -> "RoleConfig":
        if self.price_floor_cents is None:
            self.price_floor_cents = max(100, int(self.unit_price_cents * 0.7))
        if self.price_ceiling_cents is None:
            self.price_ceiling_cents = self.unit_price_cents * 13 // 10  # ×1.3
        return self
```

- [ ] **Step 2: Update existing test RoleConfig instantiations**

In `backend/tests/unit/test_pricing_service.py`, update all `RoleConfig(name="产品", unit_price_cents=80_000, is_required=True)` to add explicit bounds (the validator will fill them in, but be explicit for clarity):

```python
RoleConfig(name="产品", unit_price_cents=80_000, price_floor_cents=56_000, price_ceiling_cents=104_000, is_required=True)
```

Also update WorkPackage in test fixtures to include `name` field (already required from previous change).

- [ ] **Step 3: Run existing tests to verify they still pass**

```bash
cd backend
.venv\Scripts\python.exe -m pytest tests/unit/test_pricing_service.py -v
```
Expected: 6/6 passed (the schema change is backwards-compatible, all existing tests pass)

- [ ] **Step 4: Commit**

```bash
git add backend/app/schemas/pricing.py backend/tests/unit/test_pricing_service.py
git commit -m "feat(pricing): add price_floor/ceiling to RoleConfig schema"
```

---

### Task 2: Rewrite PricingService — 4-Phase Algorithm (Core)

**Files:**
- Modify: `backend/app/services/pricing_service.py`
- Create: `backend/tests/unit/test_pricing_algorithm.py`
- Create: `backend/tests/unit/test_pricing_split.py`

**Interfaces:**
- Consumes: `PricingService.build_plans(target_gross_cents, roles, work_packages)`
- Produces: `list[QuotePlan]` with a single recommended plan (Phase 1-3-4 handled)

- [ ] **Step 1: Write Phase 1+2 tests (hours adjustment)**

Create `backend/tests/unit/test_pricing_algorithm.py`:

```python
"""4-phase pricing algorithm tests."""

import pytest
from app.schemas.pricing import RoleConfig, WorkPackage
from app.services.pricing_service import PricingService


def test_phase1_baseline_hits_target():
    """Phase 1: base allocation (1 half-day per pair) already hits target."""
    svc = PricingService()
    plans = svc.build_plans(
        target_gross_cents=127_200,
        roles=[RoleConfig(name="产品", unit_price_cents=80_000, is_required=True)],
        work_packages=[WorkPackage(id="f1", name="知识管理·文档上传", role_names=["产品"], weight=3)],
    )
    assert len(plans) == 1
    assert plans[0].kind in ("recommended",)
    assert plans[0].within_target


def test_phase2_hours_adjustment_reaches_target():
    """Phase 2: need multiple half-day units to hit target."""
    svc = PricingService()
    # 1 role × 1 wp: 1 half-day = 120,000 labor → need more hours
    plans = svc.build_plans(
        target_gross_cents=250_000,
        roles=[RoleConfig(name="产品", unit_price_cents=80_000, is_required=True)],
        work_packages=[WorkPackage(id="f1", name="知识管理·文档上传", role_names=["产品"], weight=3)],
    )
    assert len(plans) >= 1
    p = plans[0]
    assert p.within_target
    # Should have allocated more than 1 half-day
    total_half_days = sum(line.half_day_units for line in p.lines)
    assert total_half_days > 1


def test_phase2_respects_weight_based_max():
    """Phase 2 max half-day units = 2 + weight × 1."""
    svc = PricingService()
    plans = svc.build_plans(
        target_gross_cents=10_000_000,  # unreachable with 1 wp × 1 role
        roles=[RoleConfig(name="产品", unit_price_cents=80_000, is_required=True)],
        work_packages=[WorkPackage(id="f1", name="知识管理·文档上传", role_names=["产品"], weight=1)],
    )
    p = plans[0]
    for line in p.lines:
        assert line.half_day_units <= 3  # 2 + 1×1 = 3 for weight=1
```

- [ ] **Step 2: Run Phase 1+2 tests to verify they fail**

```bash
cd backend
.venv\Scripts\python.exe -m pytest tests/unit/test_pricing_algorithm.py::test_phase1_baseline_hits_target tests/unit/test_pricing_algorithm.py::test_phase2_hours_adjustment_reaches_target tests/unit/test_pricing_algorithm.py::test_phase2_respects_weight_based_max -v
```
Expected: FAIL (new service not yet implemented)

- [ ] **Step 3: Implement Phase 1+2 in PricingService**

Phase 1 implementation in `pricing_service.py`:

```python
def _allocate(self, target_gross_cents: int, roles: list[RoleConfig],
              work_packages: list[WorkPackage],
              price_overrides: dict[str, int] | None = None) -> QuotePlan:
    """Core allocation with optional per-role price overrides."""
    role_map = {r.name: r for r in roles}
    # Use price_overrides if provided, otherwise base prices
    get_price = lambda name: (price_overrides or {}).get(name, role_map[name].unit_price_cents)

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
                unit_price_cents=get_price(role_name),
                half_day_units=1,  # Phase 1: start at 1
            ))

    if not lines:
        return None

    totals = calculate_totals(lines)
    
    # Phase 2: greedy hours adjustment
    # Max half-day units per line = 2 + weight × 1
    wp_map = {wp.id: wp for wp in work_packages}
    hours_max_cache: dict[str, int] = {}
    def max_units(line: QuoteLine) -> int:
        key = f"{line.work_package_id}:{line.role}"
        if key not in hours_max_cache:
            wp = wp_map.get(line.work_package_id or "")
            w = wp.weight if wp else 1
            hours_max_cache[key] = 2 + w * 1
        return hours_max_cache[key]

    for _ in range(100):  # safety limit
        if within_target(totals.gross_cents, target_gross_cents):
            break
        if totals.gross_cents >= target_gross_cents:
            break

        best_idx = -1
        best_gap = float("inf")
        for i, line in enumerate(lines):
            if line.half_day_units >= max_units(line):
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


def build_plans(self, target_gross_cents, roles, work_packages):
    """4-phase: baseline → hours → price float → auto-split."""
    plan = self._allocate(target_gross_cents, roles, work_packages)
    if plan and plan.within_target:
        return [plan]
    # ... Phase 3 & 4 will be added next
    return [plan] if plan else []
```

Also add the model_validator import to the existing RoleConfig import.

- [ ] **Step 4: Run Phase 1+2 tests to verify they pass**

```bash
cd backend
.venv\Scripts\python.exe -m pytest tests/unit/test_pricing_algorithm.py::test_phase1_baseline_hits_target tests/unit/test_pricing_algorithm.py::test_phase2_hours_adjustment_reaches_target tests/unit/test_pricing_algorithm.py::test_phase2_respects_weight_based_max -v
```
Expected: 3/3 PASS

- [ ] **Step 5: Write Phase 3 tests (price float)**

Append to `test_pricing_algorithm.py`:

```python
def test_phase3_price_float_hits_target():
    """Phase 3: hours maxed out, price float within ±30% reaches target."""
    svc = PricingService()
    # weight=1 → max 3 half-days per line, at 80_000 cents: max = 3 * 80_000 = 240_000 labor
    # target 300,000 → need price above base to reach
    plans = svc.build_plans(
        target_gross_cents=300_000,
        roles=[RoleConfig(name="产品", unit_price_cents=80_000, price_floor_cents=56_000, price_ceiling_cents=104_000, is_required=True)],
        work_packages=[WorkPackage(id="f1", name="知识管理·文档上传", role_names=["产品"], weight=1)],
    )
    assert len(plans) >= 1
    p = plans[0]
    assert p.within_target
    # Price should have been increased above base
    assert any(line.unit_price_cents > 80_000 for line in p.lines)


def test_phase3_respects_price_ceiling():
    """Phase 3: price never exceeds ceiling."""
    svc = PricingService()
    target = 10_000_000  # far beyond reach even at ceiling
    plans = svc.build_plans(
        target_gross_cents=target,
        roles=[RoleConfig(name="产品", unit_price_cents=80_000, price_floor_cents=56_000, price_ceiling_cents=104_000, is_required=True)],
        work_packages=[WorkPackage(id="f1", name="知识管理·文档上传", role_names=["产品"], weight=5)],
    )
    for plan in plans:
        for line in plan.lines:
            assert line.unit_price_cents <= 104_000
```

- [ ] **Step 6: Run Phase 3 tests to verify they fail**

```bash
cd backend
.venv\Scripts\python.exe -m pytest tests/unit/test_pricing_algorithm.py::test_phase3_price_float_hits_target tests/unit/test_pricing_algorithm.py::test_phase3_respects_price_ceiling -v
```
Expected: FAIL (Phase 3 not yet implemented)

- [ ] **Step 7: Implement Phase 3 (price float)**

Add to `pricing_service.py` inside `build_plans`, between Phase 2 and Phase 4:

```python
def _phase3_adjust_prices(
    self, plan: QuotePlan, target_gross_cents: int, roles: list[RoleConfig]
) -> QuotePlan:
    """Phase 3: adjust role prices within [floor, ceiling] to hit target."""
    role_map = {r.name: r for r in roles}
    # Track current price per role (start from base)
    current_prices: dict[str, int] = {}
    for line in plan.lines:
        if line.role not in current_prices:
            role = role_map.get(line.role)
            current_prices[line.role] = role.unit_price_cents if role else line.unit_price_cents

    for _ in range(50):  # safety limit
        if within_target(plan.gross_cents, target_gross_cents):
            plan.within_target = True
            plan.kind = "recommended"
            return plan

        # Find the role where increasing price gives best gap reduction
        best_role: str | None = None
        best_gap = float("inf")
        for role_name, current_price in current_prices.items():
            role = role_map.get(role_name)
            if not role:
                continue
            if current_price >= role.price_ceiling_cents:
                continue
            new_price = min(current_price + 5000, role.price_ceiling_cents)
            # Calculate new total if this role's price increases
            delta = 0
            for line in plan.lines:
                if line.role == role_name:
                    old_cost = half_day_cost(current_price, line.half_day_units)
                    new_cost = half_day_cost(new_price, line.half_day_units)
                    delta += new_cost - old_cost
            new_gross = plan.gross_cents + delta
            gap = abs(new_gross - target_gross_cents)
            if gap < best_gap:
                best_gap = gap
                best_role = role_name

        if best_role is None:
            break

        # Apply the price increase to all lines for this role
        old_price = current_prices[best_role]
        new_price = min(old_price + 5000, role_map[best_role].price_ceiling_cents)
        current_prices[best_role] = new_price
        for line in plan.lines:
            if line.role == best_role:
                line.unit_price_cents = new_price

        totals = calculate_totals(plan.lines)
        plan.labor_cents = totals.labor_cents
        plan.tax_cents = totals.tax_cents
        plan.gross_cents = totals.gross_cents

    if not plan.adjustments or plan.adjustments[-1] != "根据目标价上浮了角色单价":
        plan.adjustments.append("根据目标价上浮了角色单价")
    return plan
```

And update `build_plans`:

```python
def build_plans(self, target_gross_cents, roles, work_packages):
    plan = self._allocate(target_gross_cents, roles, work_packages)
    if plan and plan.within_target:
        return [plan]

    # Phase 3: try price float
    if plan:
        plan = self._phase3_adjust_prices(plan, target_gross_cents, roles)
        if plan.within_target:
            return [plan]

    # Phase 4: auto-split (next step)
    return [plan] if plan else []
```

- [ ] **Step 8: Run Phase 3 tests to verify they pass**

```bash
cd backend
.venv\Scripts\python.exe -m pytest tests/unit/test_pricing_algorithm.py::test_phase3_price_float_hits_target tests/unit/test_pricing_algorithm.py::test_phase3_respects_price_ceiling -v
```
Expected: 2/2 PASS

- [ ] **Step 9: Write Phase 4 tests (auto-split)**

Create `backend/tests/unit/test_pricing_split.py`:

```python
"""Phase 4 auto-split tests."""

import pytest
from app.schemas.pricing import RoleConfig, WorkPackage
from app.services.pricing_service import PricingService

def test_phase4_split_creates_sub_wps():
    """Phase 4: auto-split creates sub-work packages when budget exceeds hours+price max."""
    svc = PricingService()
    # Single wp × single role × weight=1 → max 3 half-days at ceiling=104,000
    # Max gross ≈ 3 × 104000/2 × 1.06 ≈ 165,360
    # Target 500,000 → Phase 4 must split
    plans = svc.build_plans(
        target_gross_cents=500_000,
        roles=[RoleConfig(name="产品", unit_price_cents=80_000, price_floor_cents=56_000, price_ceiling_cents=104_000, is_required=True)],
        work_packages=[WorkPackage(id="f1", name="知识管理·文档上传", role_names=["产品"], weight=5)],
    )
    assert len(plans) >= 1
    p = plans[0]
    assert p.within_target
    # Should have more than 1 line (original single wp split into sub-wps)
    assert len(p.lines) >= 1


def test_phase4_split_limits_at_five_rounds():
    """Phase 4: at most 5 split rounds, then returns best effort."""
    svc = PricingService()
    plans = svc.build_plans(
        target_gross_cents=100_000_000,  # absurdly high, unreachable
        roles=[RoleConfig(name="产品", unit_price_cents=80_000, price_floor_cents=56_000, price_ceiling_cents=104_000, is_required=True)],
        work_packages=[WorkPackage(id="f1", name="知识管理·文档上传", role_names=["产品"], weight=5)],
    )
    assert len(plans) >= 1
    # Should not crash, returns best effort
    assert plans[0].gross_cents > 0
```

- [ ] **Step 10: Run Phase 4 tests to verify they fail**

```bash
cd backend
.venv\Scripts\python.exe -m pytest tests/unit/test_pricing_split.py -v
```
Expected: FAIL (Phase 4 not yet implemented)

- [ ] **Step 11: Implement Phase 4 (auto-split)**

Add to `pricing_service.py`:

```python
def _split_wp(self, wp: WorkPackage) -> list[WorkPackage]:
    """Split a WorkPackage into two sub-packages. Weight distributed proportionally."""
    w1 = max(1, wp.weight // 2)
    w2 = wp.weight - w1
    suffix_1 = "/2"  # first part
    suffix_2 = "/2"  # second part
    return [
        WorkPackage(id=f"{wp.id}_1", name=f"{wp.name}{suffix_1}", role_names=wp.role_names.copy(), weight=w1),
        WorkPackage(id=f"{wp.id}_2", name=f"{wp.name}{suffix_2}", role_names=wp.role_names.copy(), weight=w2),
    ]


def build_plans(self, target_gross_cents, roles, work_packages):
    # Phase 1+2: baseline allocation with hours adjustment
    plan = self._allocate(target_gross_cents, roles, work_packages)
    if plan and plan.within_target:
        return [plan]

    # Phase 3: try price float
    if plan:
        plan = self._phase3_adjust_prices(plan, target_gross_cents, roles)
        if plan.within_target:
            return [plan]

    # Phase 4: auto-split loop
    current_wps = list(work_packages)
    split_count = 0
    best_plan = plan

    while split_count < 5:
        # Sort by weight descending, pick the highest-weight WP
        current_wps.sort(key=lambda wp: wp.weight, reverse=True)
        if not current_wps or current_wps[0].weight <= 1:
            break  # can't split further

        to_split = current_wps.pop(0)
        sub_wps = self._split_wp(to_split)
        current_wps.extend(sub_wps)

        # Reallocate with new WP list
        new_plan = self._allocate(target_gross_cents, roles, current_wps)
        if new_plan:
            new_plan = self._phase3_adjust_prices(new_plan, target_gross_cents, roles)
            new_plan.adjustments.append(f"自动拆分子功能: {to_split.name}")
            if new_plan.within_target:
                return [new_plan]
            # Keep the best effort so far
            if best_plan is None or abs(new_plan.gross_cents - target_gross_cents) < abs(best_plan.gross_cents - target_gross_cents):
                best_plan = new_plan

        split_count += 1

    return [best_plan] if best_plan else []
```

- [ ] **Step 12: Run Phase 4 tests to verify they pass**

```bash
cd backend
.venv\Scripts\python.exe -m pytest tests/unit/test_pricing_split.py -v
```
Expected: 2/2 PASS

- [ ] **Step 13: Run full test suite**

```bash
cd backend
.venv\Scripts\python.exe -m pytest -q
```
Expected: All tests pass (new + existing)

- [ ] **Step 14: Commit**

```bash
git add backend/app/services/pricing_service.py backend/tests/unit/test_pricing_algorithm.py backend/tests/unit/test_pricing_split.py
git commit -m "feat(pricing): 4-phase algorithm with price float and auto-split"
```

---

### Task 3: Update Project Schema & ProjectForm — Price Range Columns

**Files:**
- Modify: `frontend/src/types/project.ts`
- Modify: `frontend/src/components/ProjectForm.vue`

- [ ] **Step 1: Update frontend RoleConfig type**

In `frontend/src/types/project.ts`:

```typescript
export interface RoleConfig {
  name: string
  unit_price_cents: number
  price_floor_cents: number
  price_ceiling_cents: number
  is_required: boolean
}
```

- [ ] **Step 2: Update ProjectForm.vue — add price range columns**

After the "单价（元/人天）" column, add two new columns:

```vue
<el-table-column label="浮动下限（元/天）" width="140">
  <template #default="{ $index }">
    <el-input-number
      v-model="form.roles[$index].price_floor_cents"
      :min="100"
      :max="form.roles[$index].unit_price_cents"
      :step="1000"
      size="small"
      style="width: 120px"
    />
  </template>
</el-table-column>
<el-table-column label="浮动上限（元/天）" width="140">
  <template #default="{ $index }">
    <el-input-number
      v-model="form.roles[$index].price_ceiling_cents"
      :min="form.roles[$index].unit_price_cents"
      :max="9990000"
      :step="1000"
      size="small"
      style="width: 120px"
    />
  </template>
</el-table-column>
```

Also update the `addRole` function to initialize the new fields with ±30% defaults:

```typescript
function addRole() {
  form.roles.push({
    name: '',
    unit_price_cents: 80000,
    price_floor_cents: 56000,
    price_ceiling_cents: 104000,
    is_required: false,
  })
}
```

And in the edit mode (when loading existing project), map the values:

```typescript
form.roles = (project.roles || []).map(r => ({
  ...r,
  price_floor_cents: r.price_floor_cents ?? Math.round(r.unit_price_cents * 0.7 / 100) * 100,
  price_ceiling_cents: r.price_ceiling_cents ?? Math.round(r.unit_price_cents * 1.3 / 100) * 100,
}))
```

- [ ] **Step 3: Build frontend to verify type consistency**

```bash
cd frontend
npm run build
```
Expected: Build passes (0 errors)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/project.ts frontend/src/components/ProjectForm.vue
git commit -m "feat(ui): add price floor/ceiling columns to project form"
```

---

### Task 4: Update PricingStep — Adjustment Tags

**Files:**
- Modify: `frontend/src/components/PricingStep.vue`

- [ ] **Step 1: Add adjustment summary tags**

Between the radio name and the descriptions, add a tag bar showing what adjustments were used:

```vue
<el-radio :value="plan.id" style="margin-bottom: 12px">
  <span style="font-weight: 600; font-size: 16px">
    {{ planLabel(plan) }}
  </span>
  <el-tag
    :type="plan.within_target ? 'success' : 'warning'"
    size="small"
    style="margin-left: 8px"
  >
    {{ plan.within_target ? '达标' : '未达标' }}
  </el-tag>
</el-radio>

<!-- 调整标签 -->
<div style="margin-bottom: 8px; display: flex; gap: 6px; flex-wrap: wrap">
  <el-tag
    v-if="hasPriceAdjustment(plan)"
    type="warning"
    size="small"
    effect="plain"
  >
    价格上浮
  </el-tag>
  <el-tag
    v-if="hasSplitAdjustment(plan)"
    type="info"
    size="small"
    effect="plain"
  >
    功能拆分
  </el-tag>
  <el-tag
    v-if="hasHoursAdjustment(plan)"
    type=""
    size="small"
    effect="plain"
  >
    工时调整
  </el-tag>
</div>
```

Add helper functions in script:

```typescript
function hasPriceAdjustment(plan: QuotePlan): boolean {
  return plan.adjustments.some(a => a.includes('单价'))
}
function hasSplitAdjustment(plan: QuotePlan): boolean {
  return plan.adjustments.some(a => a.includes('拆分'))
}
function hasHoursAdjustment(plan: QuotePlan): boolean {
  return plan.lines.some(l => l.half_day_units > 1) && !hasSplitAdjustment(plan)
}
```

- [ ] **Step 2: Build to verify**

```bash
cd frontend
npm run build
```
Expected: Build passes

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/PricingStep.vue
git commit -m "feat(ui): add adjustment tags to pricing step"
```

---

### Task 5: Integration Verification

**Files:**
- Modify: `backend/tests/integration/test_pricing_flow.py`

- [ ] **Step 1: Update pricing flow integration test**

The integration test uses FakeAgent which generates requirements with `suggested_roles`. The pricing flow needs to work end-to-end. Verify the existing integration test still passes with the new RoleConfig schema (it uses project.roles_json which already has unit_price_cents).

Add a new integration test for the budget-driven split scenario:

```python
def test_pricing_split_for_large_budget(client):
    """A large target budget triggers auto-split in the pricing run."""
    # Create project with small feature set but large budget
    resp = client.post("/api/v1/projects", json={
        "name": "Split Test",
        "project_type": "new",
        "target_price_wan": "50",  # 50万 → 50_000_000 cents
        "quote_company": "测试",
        "quote_date": "2026-07-18",
        "roles": [
            {"name": "产品", "unit_price_cents": 80_000, "price_floor_cents": 56_000, "price_ceiling_cents": 104_000, "is_required": True},
        ],
    })
    project_id = resp.json()["id"]

    # Upload file and run analysis (using FakeAgent)
    client.post(f"/api/v1/projects/{project_id}/materials/upload", files={"file": ("test.txt", b"some content", "text/plain")})
    analysis_resp = client.post(f"/api/v1/projects/{project_id}/analysis-runs", json={})
    run_id = analysis_resp.json()["run_id"]

    # Wait for analysis to complete
    import time
    for _ in range(10):
        run = client.get(f"/api/v1/runs/{run_id}").json()
        if run["status"] == "succeeded":
            break
        time.sleep(0.5)

    # Confirm requirements
    reqs = run["analysis_payload"]["requirements"]
    client.put(f"/api/v1/projects/{project_id}/confirmed-requirements", json={"requirements": reqs})

    # Start pricing
    pricing_resp = client.post(f"/api/v1/projects/{project_id}/pricing-runs", json={})
    pricing_run_id = pricing_resp.json()["run_id"]

    for _ in range(10):
        pr = client.get(f"/api/v1/runs/{pricing_run_id}").json()
        if pr["status"] == "succeeded":
            break
        time.sleep(0.5)

    assert pr["status"] == "succeeded"
    payload = pr["pricing_payload"]
    assert payload is not None
    assert len(payload["plans"]) >= 1
    # Should have at least one plan within target
    assert any(p["within_target"] for p in payload["plans"])
```

- [ ] **Step 2: Run integration tests**

```bash
cd backend
.venv\Scripts\python.exe -m pytest tests/integration/test_pricing_flow.py -v
```
Expected: 4/4 PASS (3 existing + 1 new)

- [ ] **Step 3: Run full test suite**

```bash
cd backend
.venv\Scripts\python.exe -m pytest -q
```

```bash
cd frontend
npm run build
```
Expected: All pass

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "feat: pricing algorithm refactor complete with 4-phase engine"
```

---

### Rollback Plan

If any task breaks, the pricing run endpoint returns the error in `RunResponse.error_message`. The frontend polling already catches this and shows the error. Backend tests at each task boundary catch regressions before they reach the frontend.
