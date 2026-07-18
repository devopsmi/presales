<template>
  <div>
    <div v-if="loading" style="text-align: center; padding: 40px">
      <el-icon class="is-loading" :size="32">
        <i class="el-icon-loading" />
      </el-icon>
      <p style="margin-top: 12px; color: #999">正在生成报价方案…</p>
    </div>

    <template v-else-if="plans.length > 0">
      <el-alert
        title="选择方案后点击确认进入下一步"
        type="info"
        show-icon
        style="margin-bottom: 16px"
        closable
      />

      <el-radio-group v-model="selectedPlanId" style="width: 100%">
        <el-card
          v-for="(plan, index) in plans"
          :key="plan.id"
          :class="['plan-card', { selected: selectedPlanId === plan.id }]"
          shadow="hover"
          style="margin-bottom: 16px; cursor: pointer"
          @click="selectedPlanId = plan.id"
        >
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
          <div v-if="plan.adjustments.length > 0 || totalHalfDays(plan) > 1" style="margin-bottom: 8px; display: flex; gap: 6px; flex-wrap: wrap">
            <el-tag v-if="hasPriceAdjustment(plan)" type="warning" size="small" effect="plain">价格上浮</el-tag>
            <el-tag v-if="hasSplitAdjustment(plan)" type="info" size="small" effect="plain">功能拆分</el-tag>
            <el-tag v-if="totalHalfDays(plan) > 1" type="" size="small" effect="plain">工时调整</el-tag>
          </div>

          <!-- 调整说明 -->
          <el-alert
            v-for="(adj, i) in plan.adjustments"
            :key="i"
            :title="adj"
            type="warning"
            show-icon
            size="small"
            style="margin-bottom: 8px"
            :closable="false"
          />

          <el-descriptions :column="3" size="small" border style="margin-top: 8px">
            <el-descriptions-item label="人工费（元）">
              {{ formatCents(plan.labor_cents) }}
            </el-descriptions-item>
            <el-descriptions-item label="税费（元）">
              {{ formatCents(plan.tax_cents) }}
            </el-descriptions-item>
            <el-descriptions-item label="含税合计（元）">
              <span style="font-weight: 600">{{ formatCents(plan.gross_cents) }}</span>
            </el-descriptions-item>
          </el-descriptions>

          <!-- 明细表格 -->
          <el-table
            :data="plan.lines"
            :span-method="spanMethods[index]"
            style="width: 100%; margin-top: 12px"
            size="small"
          >
            <el-table-column label="功能" min-width="160">
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
            <el-table-column label="分配（半天）" width="110">
              <template #default="{ row }">
                {{ row.half_day_units }}（{{ (row.half_day_units / 2).toFixed(1) }}天）
              </template>
            </el-table-column>
            <el-table-column label="小计（元）" width="110">
              <template #default="{ row }">
                {{ formatCents(Math.round(row.unit_price_cents * row.half_day_units / 2)) }}
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-radio-group>

      <div style="text-align: right; margin-top: 16px">
        <el-button
          type="primary"
          :disabled="!selectedPlanId"
          :loading="confirming"
          @click="handleConfirm"
        >
          确认方案
        </el-button>
      </div>
    </template>

    <el-empty v-else description="暂无报价方案" />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { ElMessage } from 'element-plus'
import type { QuotePlan, QuoteLine } from '@/types/pricing'

const props = defineProps<{
  plans: QuotePlan[]
  loading: boolean
  projectId: string
  runId: string | null
}>()

const emit = defineEmits<{
  selected: [planId: string, runId: string]
}>()

const selectedPlanId = ref<string | null>(null)
const confirming = ref(false)

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

function hasPriceAdjustment(plan: QuotePlan): boolean {
  return plan.adjustments.some(a => a.includes('单价'))
}

function hasSplitAdjustment(plan: QuotePlan): boolean {
  return plan.adjustments.some(a => a.includes('拆分'))
}

function totalHalfDays(plan: QuotePlan): number {
  return plan.lines.reduce((s, l) => s + l.half_day_units, 0)
}

/** 为 el-table 生成合并单元格方法 — 合并相同 work_package_name 的"功能"列 */
function createSpanMethod(lines: QuoteLine[]) {
  // 找出连续相同 work_package_name 的分组
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
    // 检查当前行是否被上方合并隐藏
    const hidden = Object.entries(groups).some(([s, count]) => {
      const si = parseInt(s)
      return rowIndex > si && rowIndex < si + count
    })
    if (hidden) return { rowspan: 0, colspan: 0 }

    if (columnIndex === 0 && groups[rowIndex]) {
      return { rowspan: groups[rowIndex], colspan: 1 }
    }
    return { rowspan: 1, colspan: 1 }
  }
}

const spanMethods = computed(() =>
  props.plans.map(plan => createSpanMethod(plan.lines))
)

async function handleConfirm() {
  if (!selectedPlanId.value || !props.runId) return
  confirming.value = true
  try {
    emit('selected', selectedPlanId.value, props.runId)
  } finally {
    confirming.value = false
  }
}

watch(() => props.plans, (plans) => {
  if (plans.length > 0 && !selectedPlanId.value) {
    // 默认选中第一个达标方案或第一个方案
    const recommended = plans.find(p => p.within_target)
    selectedPlanId.value = recommended?.id || plans[0].id
  }
}, { immediate: true })
</script>

<style scoped>
.plan-card.selected {
  border-color: #409eff;
  box-shadow: 0 0 0 1px #409eff;
}
</style>
