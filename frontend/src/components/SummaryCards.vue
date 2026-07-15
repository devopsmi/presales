<script setup lang="ts">
import type { Summary } from '@/types'

const props = defineProps<{
  summary: Summary
}>()

function money(v: number): string {
  if (v >= 10000) return `${(v / 10000).toFixed(1)}万元`
  return `¥${v.toLocaleString()}`
}

const cards = [
  { label: '后端人天', value: props.summary.total_backend_days, suffix: '天' },
  { label: '前端人天', value: props.summary.total_frontend_days, suffix: '天' },
  { label: '测试人天', value: props.summary.total_test_days, suffix: '天' },
  { label: '后端费用', value: money(props.summary.backend_cost), suffix: '' },
  { label: '前端费用', value: money(props.summary.frontend_cost), suffix: '' },
  { label: '测试费用', value: money(props.summary.test_cost), suffix: '' },
  { label: '实时费合计', value: money(props.summary.total_labor_cost), suffix: '' },
  { label: '管理费15%', value: money(props.summary.management_fee), suffix: '' },
  { label: '税金6%', value: money(props.summary.tax), suffix: '' },
  { label: '总计', value: money(props.summary.grand_total), suffix: '', highlight: true },
]
</script>

<template>
  <section v-if="summary.total_backend_days" class="summary-cards">
    <div
      v-for="(card, i) in cards"
      :key="i"
      class="card"
      :class="{ highlight: card.highlight }"
    >
      <span class="card-label">{{ card.label }}</span>
      <span class="card-value">{{ card.value }}<span v-if="card.suffix" class="card-suffix">{{ card.suffix }}</span></span>
    </div>
  </section>
</template>

<style scoped>
.summary-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 10px;
  margin-top: 20px;
}

.card {
  background: #fff;
  border-radius: 10px;
  padding: 14px;
  text-align: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.card.highlight {
  background: linear-gradient(135deg, #4a6cf7, #6c63ff);
  color: #fff;
}

.card-label {
  display: block;
  font-size: 12px;
  color: #888;
  margin-bottom: 6px;
}

.card.highlight .card-label {
  color: rgba(255, 255, 255, 0.8);
}

.card-value {
  display: block;
  font-size: 18px;
  font-weight: 700;
  color: #1a1a2e;
}

.card.highlight .card-value {
  color: #fff;
}

.card-suffix {
  font-size: 12px;
  font-weight: 400;
  color: #888;
  margin-left: 2px;
}

.card.highlight .card-suffix {
  color: rgba(255, 255, 255, 0.8);
}
</style>
