<template>
  <div>
    <el-alert
      title="报价方案已确认，可导出报价单或重新选择方案"
      type="success"
      show-icon
      style="margin-bottom: 16px"
      closable
    />

    <el-card style="margin-bottom: 20px">
      <template #header>
        <div style="display: flex; justify-content: space-between; align-items: center">
          <span>已选方案 · {{ planLabel(selectedPlan) }}</span>
          <el-button type="primary" :loading="exporting" @click="handleExport">
            <el-icon style="margin-right: 4px"><i class="el-icon-download" /></el-icon>
            导出 Excel 报价单
          </el-button>
        </div>
      </template>

      <div v-if="selectedPlan.adjustments.length > 0" style="margin-bottom: 12px; display: flex; gap: 6px; flex-wrap: wrap">
        <el-tag v-if="hasPriceAdjustment(selectedPlan)" type="warning" size="small" effect="plain">价格上浮</el-tag>
        <el-tag v-if="hasSplitAdjustment(selectedPlan)" type="info" size="small" effect="plain">功能拆分</el-tag>
        <el-tag v-if="totalHalfDays(selectedPlan) > 1" type="" size="small" effect="plain">工时调整</el-tag>
      </div>

      <el-descriptions :column="3" size="small" border>
        <el-descriptions-item label="目标报价（万元）">
          {{ formatWan(project.target_gross_cents) }}
        </el-descriptions-item>
        <el-descriptions-item label="人工费（元）">
          {{ formatCents(selectedPlan.labor_cents) }}
        </el-descriptions-item>
        <el-descriptions-item label="税费（元）">
          {{ formatCents(selectedPlan.tax_cents) }}
        </el-descriptions-item>
        <el-descriptions-item label="含税合计（元）">
          <span style="font-weight: 600">{{ formatCents(selectedPlan.gross_cents) }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="差额（万元）">
          <span :style="{ color: selectedPlan.within_target ? 'green' : 'red', fontWeight: 600 }">
            {{ formatDiff(selectedPlan) }}
          </span>
        </el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="selectedPlan.within_target ? 'success' : 'warning'" size="small">
            {{ selectedPlan.within_target ? '已达标' : '未达标' }}
          </el-tag>
        </el-descriptions-item>
      </el-descriptions>

      <el-table
        :data="selectedPlan.lines"
        :span-method="spanMethod"
        style="width: 100%; margin-top: 16px"
        size="small"
        border
      >
        <el-table-column type="index" label="序号" width="60" />
        <el-table-column label="功能模块" min-width="180">
          <template #default="{ row }">
            {{ row.work_package_name || row.work_package_id || '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="role" label="角色" width="100" />
        <el-table-column label="单价（元/人天）" width="130">
          <template #default="{ row }">
            {{ (row.unit_price_cents / 100).toFixed(0) }}
          </template>
        </el-table-column>
        <el-table-column label="分配（半天）" width="100">
          <template #default="{ row }">
            {{ row.half_day_units }}
          </template>
        </el-table-column>
        <el-table-column label="折合天数" width="100">
          <template #default="{ row }">
            {{ (row.half_day_units / 2).toFixed(1) }}
          </template>
        </el-table-column>
        <el-table-column label="小计（元）" width="120">
          <template #default="{ row }">
            {{ formatCents(Math.round(row.unit_price_cents * row.half_day_units / 2)) }}
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <div style="display: flex; justify-content: space-between">
      <el-button @click="$emit('back')">返回报价方案</el-button>
      <el-button type="primary" :loading="exporting" @click="handleExport">
        导出 Excel 报价单
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import type { Project } from '@/types/project'
import type { QuotePlan, QuoteLine } from '@/types/pricing'
import { exportQuote } from '@/api/projects'

const props = defineProps<{
  project: Project
  plan: QuotePlan
}>()

defineEmits<{
  back: []
}>()

const exporting = ref(false)

const selectedPlan = computed(() => props.plan)

const PLAN_LABELS: Record<string, string> = {
  recommended: '推荐方案',
  adjusted: '调整方案',
  closest: '最接近方案',
}

function planLabel(plan: QuotePlan): string {
  return PLAN_LABELS[plan.kind] || plan.kind
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatWan(cents: number): string {
  return `${(cents / 100 / 10000).toFixed(2)}`
}

function formatDiff(plan: QuotePlan): string {
  const diff = plan.gross_cents - props.project.target_gross_cents
  return `${(diff / 100 / 10000).toFixed(2)}`
}

function hasPriceAdjustment(plan: QuotePlan): boolean {
  return plan.adjustments.some((a: string) => a.includes('单价'))
}

function hasSplitAdjustment(plan: QuotePlan): boolean {
  return plan.adjustments.some((a: string) => a.includes('拆分'))
}

function totalHalfDays(plan: QuotePlan): number {
  return plan.lines.reduce((s: number, l: QuoteLine) => s + l.half_day_units, 0)
}

/** 为 el-table 生成合并单元格方法 — 合并相同 work_package_name 的"功能模块"列 */
function createSpanMethod(lines: QuoteLine[]) {
  const groups: Record<number, number> = {}
  let start = 0
  const key = (i: number) => lines[i]?.work_package_name ?? lines[i]?.work_package_id ?? '-'
  for (let i = 1; i <= lines.length; i++) {
    if (i === lines.length || key(i) !== key(start)) {
      if (i - start > 1) groups[start] = i - start
      start = i
    }
  }

  return ({ rowIndex, columnIndex }: { rowIndex: number; columnIndex: number }) => {
    const hidden = Object.entries(groups).some(([s, count]) => {
      const si = parseInt(s)
      return rowIndex > si && rowIndex < si + count
    })
    // 只对被合并的行的第 1 列（功能模块）隐藏，其它列正常显示
    if (hidden && columnIndex === 1) return { rowspan: 0, colspan: 0 }
    if (columnIndex === 1 && groups[rowIndex]) {
      return { rowspan: groups[rowIndex], colspan: 1 }
    }
    return { rowspan: 1, colspan: 1 }
  }
}

const spanMethod = computed(() => createSpanMethod(props.plan.lines))

async function handleExport() {
  exporting.value = true
  try {
    await exportQuote(props.project.id, props.project.name || undefined)
    ElMessage.success('报价单已导出')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '导出失败')
  } finally {
    exporting.value = false
  }
}
</script>
