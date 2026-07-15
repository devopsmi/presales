<script setup lang="ts">
import { computed, ref } from 'vue'
import type { EstimateTask, Summary } from '@/types'

const props = defineProps<{
  tasks: EstimateTask[]
  summary: Summary
}>()

const searchKeyword = ref('')

/** 搜索过滤（保持模块 → 子模块分组结构） */
const filtered = computed(() => {
  let list = [...props.tasks]
  const kw = searchKeyword.value.trim().toLowerCase()
  if (kw) {
    list = list.filter(
      (t) =>
        t.module.toLowerCase().includes(kw) ||
        t.sub_module.toLowerCase().includes(kw) ||
        t.feature.toLowerCase().includes(kw) ||
        t.description.toLowerCase().includes(kw) ||
        t.processor.toLowerCase().includes(kw),
    )
  }
  return list
})

/** 构建分组行（含层级合并信息 + 小计） */
interface DisplayRow {
  task: EstimateTask
  moduleRowspan: number
  subModuleRowspan: number
  isSubTotal: boolean
  isModuleTotal: boolean
}

const displayRows = computed(() => {
  const rows: DisplayRow[] = []
  const groups = new Map<string, Map<string, EstimateTask[]>>()
  const modOrder: string[] = []
  const subOrder = new Map<string, string[]>()

  for (const t of filtered.value) {
    if (!groups.has(t.module)) {
      groups.set(t.module, new Map())
      modOrder.push(t.module)
      subOrder.set(t.module, [])
    }
    const sub = groups.get(t.module)!
    if (!sub.has(t.sub_module)) {
      sub.set(t.sub_module, [])
      subOrder.get(t.module)!.push(t.sub_module)
    }
    sub.get(t.sub_module)!.push(t)
  }

  for (const mod of modOrder) {
    const subMap = groups.get(mod)!
    const subs = subOrder.get(mod)!
    let modB = 0, modF = 0, modT = 0

    for (const sub of subs) {
      const tasks = subMap.get(sub)!
      const subB = tasks.reduce((s, t) => s + t.backend_days, 0)
      const subF = tasks.reduce((s, t) => s + t.frontend_days, 0)
      const subT = tasks.reduce((s, t) => s + t.test_days, 0)
      modB += subB; modF += subF; modT += subT

      for (let i = 0; i < tasks.length; i++) {
        rows.push({
          task: tasks[i],
          moduleRowspan: i === 0 ? tasks.length + 1 : 0,
          subModuleRowspan: i === 0 ? tasks.length + 1 : 0,
          isSubTotal: false,
          isModuleTotal: false,
        })
      }

      // 子模块小计行
      rows.push({
        task: {
          serial: 0, module: mod, sub_module: sub,
          feature: '', processor: '', description: `${sub} 小计`,
          backend_days: subB, frontend_days: subF, test_days: subT, remark: '',
        },
        moduleRowspan: 0, subModuleRowspan: 0,
        isSubTotal: true, isModuleTotal: false,
      })
    }

    // 模块合计行
    if (subs.length > 1) {
      rows.push({
        task: {
          serial: 0, module: mod, sub_module: '',
          feature: '', processor: '', description: `${mod} 合计`,
          backend_days: modB, frontend_days: modF, test_days: modT, remark: '',
        },
        moduleRowspan: 0, subModuleRowspan: 0,
        isSubTotal: false, isModuleTotal: true,
      })
    }
  }
  return rows
})

function fmt(v: number): string {
  return Number.isInteger(v) ? v.toString() : v.toFixed(1)
}

function money(v: number): string {
  if (v >= 10000) return `¥${(v / 10000).toFixed(1)}万`
  return `¥${v.toLocaleString()}`
}
</script>

<template>
  <section v-if="tasks.length" class="budget-section">
    <h2 class="section-title">软件开发报价清单</h2>
    <p class="section-desc">金额：元</p>

    <div class="table-toolbar">
      <input v-model="searchKeyword" placeholder="搜索模块、功能、加工方..." class="search-input" />
      <span class="count-badge">共 {{ tasks.length }} 项功能</span>
    </div>

    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th class="col-serial">序号</th>
            <th class="col-module">模块</th>
            <th class="col-sub">子模块</th>
            <th class="col-feature">功能</th>
            <th class="col-processor">加工方</th>
            <th class="col-desc">功能描述</th>
            <th class="col-days">后端</th>
            <th class="col-days">前端</th>
            <th class="col-days">测试</th>
            <th class="col-remark">备注</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(row, i) in displayRows" :key="i">
            <!-- 小计 / 合计 -->
            <tr v-if="row.isSubTotal || row.isModuleTotal" :class="row.isModuleTotal ? 'row-module-total' : 'row-subtotal'">
              <td class="col-serial" />
              <td v-if="row.isModuleTotal" colspan="4" class="total-label">{{ row.task.description }}</td>
              <td v-else colspan="4" class="total-label">{{ row.task.description }}</td>
              <td />
              <td class="days-cell">{{ fmt(row.task.backend_days) }}</td>
              <td class="days-cell">{{ fmt(row.task.frontend_days) }}</td>
              <td class="days-cell">{{ fmt(row.task.test_days) }}</td>
              <td />
            </tr>
            <!-- 正常数据行 -->
            <tr v-else>
              <td class="col-serial">{{ row.task.serial }}</td>
              <td v-if="row.moduleRowspan > 0" :rowspan="row.moduleRowspan" class="cell-module">
                {{ row.task.module }}
              </td>
              <td v-if="row.subModuleRowspan > 0" :rowspan="row.subModuleRowspan" class="cell-submodule">
                {{ row.task.sub_module }}
              </td>
              <td>{{ row.task.feature }}</td>
              <td><span class="tag-processor">{{ row.task.processor }}</span></td>
              <td class="cell-desc">{{ row.task.description }}</td>
              <td class="days-cell">{{ row.task.backend_days ? fmt(row.task.backend_days) : '-' }}</td>
              <td class="days-cell">{{ row.task.frontend_days ? fmt(row.task.frontend_days) : '-' }}</td>
              <td class="days-cell">{{ row.task.test_days ? fmt(row.task.test_days) : '-' }}</td>
              <td class="cell-remark">{{ row.task.remark }}</td>
            </tr>
          </template>
          <tr v-if="!displayRows.length">
            <td colspan="10" class="empty-row">无匹配数据</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ====== 底部汇总（与模板一致） ====== -->
    <div class="summary-footer">
      <table class="footer-table">
        <tbody>
          <tr>
            <td class="footer-label">实时合计</td>
            <td class="footer-empty" colspan="5" />
            <td class="days-cell">{{ fmt(summary.total_backend_days) }}</td>
            <td class="days-cell">{{ fmt(summary.total_frontend_days) }}</td>
            <td class="days-cell">{{ fmt(summary.total_test_days) }}</td>
            <td />
          </tr>
          <tr>
            <td class="footer-label">实时单价</td>
            <td colspan="5" />
            <td class="days-cell">{{ money(summary.backend_daily_rate) }}</td>
            <td class="days-cell">{{ money(summary.frontend_daily_rate) }}</td>
            <td class="days-cell">{{ money(summary.test_daily_rate) }}</td>
            <td />
          </tr>
          <tr>
            <td class="footer-label">实时小计</td>
            <td colspan="5" />
            <td class="days-cell">{{ money(summary.backend_cost) }}</td>
            <td class="days-cell">{{ money(summary.frontend_cost) }}</td>
            <td class="days-cell">{{ money(summary.test_cost) }}</td>
            <td />
          </tr>
          <tr class="footer-highlight">
            <td class="footer-label">实时费合计</td>
            <td colspan="8" />
            <td class="money-cell">{{ money(summary.total_labor_cost) }}</td>
          </tr>
          <tr>
            <td class="footer-label">管理费{{ (summary.management_fee_rate * 100).toFixed(0) }}%</td>
            <td colspan="8" />
            <td class="money-cell">{{ money(summary.management_fee) }}</td>
          </tr>
          <tr>
            <td class="footer-label">税金{{ (summary.tax_rate * 100).toFixed(0) }}%</td>
            <td colspan="8" />
            <td class="money-cell">{{ money(summary.tax) }}</td>
          </tr>
          <tr class="footer-grand">
            <td class="footer-label">合计</td>
            <td colspan="8" />
            <td class="money-cell grand">{{ money(summary.grand_total) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.budget-section {
  background: #fff;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  margin-top: 20px;
}

.section-title {
  margin: 0 0 4px;
  font-size: 18px;
  color: #1a1a2e;
}

.section-desc {
  margin: 0 0 16px;
  font-size: 13px;
  color: #999;
}

.table-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.search-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
}

.search-input:focus {
  outline: none;
  border-color: #4a6cf7;
}

.count-badge {
  font-size: 13px;
  color: #888;
  white-space: nowrap;
}

.table-wrapper {
  overflow-x: auto;
  margin-bottom: 0;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

th {
  background: #f5f7fa;
  padding: 8px 10px;
  text-align: center;
  font-weight: 600;
  color: #555;
  white-space: nowrap;
  border-bottom: 2px solid #e0e0e0;
}

td {
  padding: 8px 10px;
  border-bottom: 1px solid #f0f0f0;
  color: #333;
  vertical-align: top;
}

.col-serial { width: 40px; text-align: center; }
.col-module { min-width: 100px; }
.col-sub { min-width: 100px; }
.col-feature { min-width: 80px; }
.col-processor { min-width: 70px; }
.col-desc { min-width: 180px; }
.col-days { width: 50px; text-align: center; }
.col-remark { min-width: 80px; }

.days-cell {
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.money-cell {
  text-align: right;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.cell-module {
  font-weight: 600;
  color: #1a1a2e;
  background: #fafbff;
  vertical-align: middle;
  text-align: center;
}

.cell-submodule {
  font-weight: 500;
  color: #444;
  background: #fcfcfc;
  vertical-align: middle;
}

.cell-desc {
  font-size: 12px;
  color: #555;
  line-height: 1.5;
}

.cell-remark {
  font-size: 12px;
  color: #888;
}

.tag-processor {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  background: #e8f0fe;
  color: #1a73e8;
  white-space: nowrap;
}

/* 小计/合计行 */
.row-subtotal td,
.row-module-total td {
  background: #f8f9fc;
  font-weight: 600;
  border-top: 2px solid #e8ecf4;
  border-bottom: 2px solid #e8ecf4;
  padding: 6px 10px;
}

.row-module-total td {
  background: #eef2ff;
}

.total-label {
  color: #666;
  font-size: 13px;
  text-align: right;
  padding-right: 16px;
}

.empty-row {
  text-align: center;
  color: #999;
  padding: 24px;
}

/* 底部汇总 */
.summary-footer {
  margin-top: 0;
  border-top: 2px solid #1a1a2e;
}

.footer-table {
  width: 100%;
}

.footer-table td {
  padding: 8px 10px;
  border-bottom: 1px solid #e8e8e8;
}

.footer-label {
  font-weight: 600;
  color: #1a1a2e;
  white-space: nowrap;
  width: 100px;
}

.footer-empty {
  min-width: 0;
}

.footer-highlight td {
  background: #f0f4ff;
  border-top: 2px solid #4a6cf7;
  border-bottom: 2px solid #4a6cf7;
}

.footer-grand td {
  background: #1a1a2e;
  color: #fff;
  border-top: 2px solid #1a1a2e;
  border-bottom: 2px solid #1a1a2e;
}

.grand {
  font-size: 16px;
  font-weight: 700;
}
</style>
