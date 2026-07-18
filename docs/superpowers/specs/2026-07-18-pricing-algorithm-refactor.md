# 报价算法重构：预算驱动自动拆分 + 价格浮动

## 问题

当前报价算法在以下场景表现不佳：

- **达标方案**：单价被等比拉高到不合理水平（如 800→11,111 元/天）
- **未达标方案**：总额远低于目标价，因工时上限硬约束（每人最多 3 天）

根本原因：算法缺乏**价格范围约束**和**预算驱动自动拆分**机制。

## 方案 A（选定）

四阶段递进分配：工时 → 价格浮动 → 自动拆分，逐步释放自由度。

### 数据模型变更

```python
class RoleConfig(BaseModel):
    name: str
    unit_price_cents: int        # 基准单价（分）
    price_floor_cents: int       # 浮动下限 = base × 0.7
    price_ceiling_cents: int     # 浮动上限 = base × 1.3
    is_required: bool
```

### 四阶段流程

```
输入：角色配置（含价格范围） + 需求列表（WorkPackages） + 目标总价
│
Phase 1 ── 基准分配：每(角色,功能) 1个半天，基准单价
│             总额命中目标±3% → recommended ✅
│
Phase 2 ── 工时调整：1~6个半天（按 weight 弹性上限）
│             命中目标 → recommended ✅
│
Phase 3 ── 价格浮动：每角色在 [floor, ceiling] 内微调
│             命中目标 → recommended ✅
│
Phase 4 ── 自动拆分：最高 weight 的 WP 一分为二
│             回到 Phase 2 重分配（最多 5 轮）
```

### Phase 2：工时调整

- 每(角色,功能)对最小分配：1 个半天（weight≥1 保底）
- 最大分配：`2 + weight × 1` 个半天（weight=5→7半天, weight=1→3半天）
- 贪心循环：每次选择最能缩小与目标差距的(角色,功能)对，增加 1 个半天

### Phase 3：价格浮动

- 每角色独立配置 [floor, ceiling]，默认 ±30%
- 在工时已分满仍未命中时触发
- 微调步长：每次 +5000 分（50 元），优先调整差额最大的对
- 不超 ceiling

### Phase 4：自动拆分 (Budget-Driven Decomposition)

触发条件：Phase 3 结束后总额仍低于目标价 × 97%

拆分策略：
- 按 weight 降序排列 WorkPackages
- 每次取 weight 最大者，按比例分为两个子 WP
- 子 WP 继承 role_names，weight 按原 weight 比例分配（总和不变）
- 子 WP 命名追加 `/2`、`/3` 后缀
- 拆完后立即回到 Phase 2 重新分配
- 最多递归 5 轮，每轮拆 1 个

边界保护：
- 最小子 WP weight ≥ 1（不再拆分）
- 最多递归 5 层
- 防止无限拆分

### 方案输出

最多返回 3 个方案：
1. **recommended**：命中目标的方案（可能经过 Phase 2/3/4 调整）
2. **adjusted_1**：备选方案（不同拆分路径）
3. **adjusted_2**：备选方案

每个方案标注使用了哪些调整手段：
```
[工时: 3功能×2角色] [价格: 产品+15%] [拆分: 文档上传/2]
```

### 前端变化

1. **ProjectForm.vue**：角色表格新增「浮动下限」「浮动上限」列，默认 ±30%，可手动编辑
2. **PricingStep.vue**：方案顶部增加调整标签(tag)，展示具体调整手段

### 测试策略

- Phase1-3 单元测试：给定角色+WP+目标价，验证命中/未命中
- Phase4 拆分测试：验证 weight 分配和命名规则
- 边界测试：单个 WP + 单个角色能否通过 Phase4 命中目标
- 价格浮动测试：验证 price_floor/ceiling 约束不被突破
