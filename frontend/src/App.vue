<script setup lang="ts">
import { ref } from 'vue'
import { useGenerate } from '@/composables/useGenerate'
import { exportDesignDocx, exportEstimateXlsx } from '@/api/generate'
import type { GenerateFormData } from '@/types'
import InputPanel from '@/components/InputPanel.vue'
import MarkdownView from '@/components/MarkdownView.vue'
import EstimateTable from '@/components/EstimateTable.vue'
import SummaryCards from '@/components/SummaryCards.vue'

const { loading, error, result, generate, reset } = useGenerate()

const formData = ref<GenerateFormData>({
  requirement: '',
  companyName: '',
  projectName: '',
  quotationUnit: '',
  maxBudget: 0,
  roles: [],
})

function onGenerate(data: GenerateFormData, file?: File) {
  formData.value = data
  generate(data, file)
}

function onExportDesign() {
  if (result.value) {
    exportDesignDocx(result.value.design.markdown)
  }
}

function onExportEstimate() {
  if (result.value) {
    const f = formData.value
    exportEstimateXlsx(
      result.value.estimate.tasks,
      result.value.estimate.summary,
      f.companyName,
      f.projectName,
      f.quotationUnit,
    )
  }
}

function onRetry() {
  const f = formData.value
  reset()
  generate(f)
}
</script>

<template>
  <div class="app-container">
    <div class="content">
      <InputPanel @generate="onGenerate" />

      <div v-if="loading" class="loading-bar">
        <div class="loading-spinner" />
        <span>正在生成方案，请稍候...</span>
      </div>

      <div v-if="error" class="error-bar">
        <span>❌ {{ error }}</span>
      </div>

      <template v-if="result">
        <!-- 审核结果 -->
        <div v-if="!result.review.passed" class="review-bar review-fail">
          <div class="review-header">
            <span class="review-icon">⚠️</span>
            <span class="review-title">内容审核未通过</span>
          </div>
          <p class="review-summary">{{ result.review.summary }}</p>
          <div v-if="result.review.issues.length" class="review-issues">
            <div v-for="(iss, i) in result.review.issues" :key="i" class="review-issue-item">
              <div class="issue-type">[{{ iss.type }}]</div>
              <div class="issue-detail">{{ iss.detail }}</div>
              <div v-if="iss.suggestion" class="issue-suggestion">💡 {{ iss.suggestion }}</div>
            </div>
          </div>
          <button class="btn-retry" @click="onRetry">🔄 重新生成</button>
        </div>
        <div v-else-if="result.review.issues.length" class="review-bar review-pass">
          <span class="review-icon">✅</span>
          <span>{{ result.review.summary }}</span>
          <div class="review-issues">
            <div v-for="(iss, i) in result.review.issues" :key="i" class="review-issue-item">
              <div class="issue-type">[{{ iss.type }}]</div>
              <div class="issue-detail">{{ iss.detail }}</div>
              <div v-if="iss.suggestion" class="issue-suggestion">💡 {{ iss.suggestion }}</div>
            </div>
          </div>
        </div>

        <!-- 导出 + 结果 -->
        <div class="export-bar">
          <button class="btn-export" @click="onExportDesign">
            📄 导出设计方案 (Word)
          </button>
          <button class="btn-export btn-export-green" @click="onExportEstimate">
            📊 导出报价单 (Excel)
          </button>
        </div>

        <MarkdownView :content="result.design.markdown" />
        <EstimateTable
          :tasks="result.estimate.tasks"
          :summary="result.estimate.summary"
        />
        <SummaryCards :summary="result.estimate.summary" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.app-container {
  min-height: 100vh;
  background: #f5f7fa;
  padding: 40px 16px;
}

.content {
  max-width: 960px;
  margin: 0 auto;
}

.export-bar {
  display: flex;
  gap: 12px;
  margin: 20px 0;
}

.btn-export {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  border: 1px solid #4a6cf7;
  border-radius: 8px;
  background: #fff;
  color: #4a6cf7;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-export:hover {
  background: #4a6cf7;
  color: #fff;
}

.btn-export-green {
  border-color: #22c55e;
  color: #22c55e;
}

.btn-export-green:hover {
  background: #22c55e;
  color: #fff;
}

/* 审核结果 */
.review-bar {
  margin-top: 20px;
  padding: 16px 20px;
  border-radius: 8px;
  font-size: 14px;
}

.review-pass {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #166534;
}

.review-fail {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
}

.review-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.review-icon {
  font-size: 18px;
}

.review-title {
  font-weight: 700;
  font-size: 15px;
}

.review-summary {
  margin: 4px 0;
  color: inherit;
}

.review-issues {
  margin: 8px 0;
}

.review-issue-item {
  padding: 8px 12px;
  margin-bottom: 6px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.03);
  line-height: 1.5;
}

.review-fail .review-issue-item {
  background: rgba(153, 27, 27, 0.05);
}

.issue-type {
  font-weight: 600;
  font-size: 12px;
  color: #666;
  text-transform: uppercase;
}

.issue-detail {
  font-size: 14px;
  color: inherit;
  margin: 2px 0;
}

.issue-suggestion {
  font-size: 13px;
  color: #4a6cf7;
  margin-top: 4px;
  padding: 4px 8px;
  border-radius: 4px;
  background: rgba(74, 108, 247, 0.08);
}

.btn-retry {
  margin-top: 10px;
  padding: 8px 20px;
  border: 1px solid #991b1b;
  border-radius: 6px;
  background: #fff;
  color: #991b1b;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-retry:hover {
  background: #991b1b;
  color: #fff;
}

.loading-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 20px;
  padding: 20px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  color: #666;
  font-size: 15px;
}

.loading-spinner {
  width: 24px;
  height: 24px;
  border: 3px solid #e0e0e0;
  border-top-color: #4a6cf7;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-bar {
  margin-top: 20px;
  padding: 14px 20px;
  background: #fff0f0;
  border-radius: 8px;
  color: #d93025;
  font-size: 14px;
  border: 1px solid #f5c6cb;
}
</style>
