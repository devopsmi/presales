<script setup lang="ts">
import { ref, reactive } from 'vue'
import type { GenerateFormData } from '@/types'

const emit = defineEmits<{
  generate: [data: GenerateFormData, file?: File]
}>()

const form = reactive<GenerateFormData>({
  requirement: '',
  companyName: '',
  projectName: '',
  quotationUnit: '',
  maxBudget: 0,
  roles: ['后端工程师', '前端工程师', '测试工程师'],
})

const selectedFile = ref<File | null>(null)
const dragOver = ref(false)
const newRole = ref('')

function addRole() {
  const r = newRole.value.trim()
  if (r && !form.roles.includes(r)) {
    form.roles.push(r)
    newRole.value = ''
  }
}

function removeRole(index: number) {
  form.roles.splice(index, 1)
}

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files && input.files.length > 0) {
    selectedFile.value = input.files[0]
  }
}

function handleDrop(event: DragEvent) {
  dragOver.value = false
  const files = event.dataTransfer?.files
  if (files && files.length > 0) {
    selectedFile.value = files[0]
  }
}

function removeFile() {
  selectedFile.value = null
}

function onSubmit() {
  if (!form.requirement.trim()) return
  emit('generate', { ...form }, selectedFile.value || undefined)
}
</script>

<template>
  <section class="input-panel">
    <div class="input-header">
      <h2>AI 软件方案设计 Agent</h2>
      <p class="desc">填写基本信息并描述需求，自动生成软件设计方案与开发报价</p>
    </div>

    <div class="form-body">
      <!-- 第一行：客户 / 项目 -->
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">客户名称</label>
          <input v-model="form.companyName" placeholder="例：某某科技有限公司" class="form-input" />
        </div>
        <div class="form-group">
          <label class="form-label">项目名称</label>
          <input v-model="form.projectName" placeholder="例：疼痛管理系统 V1.0" class="form-input" />
        </div>
        <div class="form-group">
          <label class="form-label">报价单位</label>
          <input v-model="form.quotationUnit" placeholder="例：某某软件公司" class="form-input" />
        </div>
      </div>

      <!-- 第二行：预算上限 -->
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">预算上限（元）</label>
          <input v-model.number="form.maxBudget" type="number" min="0" placeholder="0 表示不限制" class="form-input" />
        </div>
        <div class="form-group">
          <label class="form-label">需求描述</label>
          <textarea
            v-model="form.requirement"
            placeholder="请输入需求描述，例如：设计一套疼痛管理系统"
            rows="3"
            class="form-input requirement-input"
          />
        </div>
      </div>

      <!-- 第三行：岗位管理 -->
      <div class="form-row">
        <div class="form-group roles-group">
          <label class="form-label">执行方（岗位）</label>
          <div class="roles-list">
            <span v-for="(role, i) in form.roles" :key="i" class="role-tag">
              {{ role }}
              <button class="role-remove" @click="removeRole(i)">&times;</button>
            </span>
          </div>
          <div class="role-add-row">
            <input v-model="newRole" placeholder="输入岗位名称" class="form-input role-input" @keyup.enter="addRole" />
            <button class="btn-add" @click="addRole">+ 添加</button>
          </div>
        </div>
      </div>

      <!-- 文件上传 -->
      <div
        class="file-dropzone"
        :class="{ 'drag-over': dragOver }"
        @dragover.prevent="dragOver = true"
        @dragleave="dragOver = false"
        @drop.prevent="handleDrop"
      >
        <template v-if="!selectedFile">
          <label class="file-label">
            <span class="file-icon">📎</span>
            <span>上传参考文档（支持 PDF / Word / Excel / TXT）</span>
            <input type="file" accept=".pdf,.docx,.xlsx,.txt" hidden @change="handleFileChange" />
          </label>
        </template>
        <template v-else>
          <div class="file-info">
            <span>{{ selectedFile.name }}</span>
            <button class="btn-text" @click="removeFile">移除</button>
          </div>
        </template>
      </div>

      <button class="btn-generate" :disabled="!form.requirement.trim()" @click="onSubmit">
        🤖 生成方案
      </button>
    </div>
  </section>
</template>

<style scoped>
.input-panel {
  background: #fff;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
}

.input-header {
  margin-bottom: 20px;
}

.input-header h2 {
  margin: 0 0 8px;
  font-size: 20px;
  color: #1a1a2e;
}

.desc {
  margin: 0;
  color: #888;
  font-size: 14px;
}

.form-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-row {
  display: flex;
  gap: 14px;
}

.form-group {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-label {
  font-size: 13px;
  font-weight: 600;
  color: #555;
}

.form-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  box-sizing: border-box;
  transition: border-color 0.2s;
}

.form-input:focus {
  outline: none;
  border-color: #4a6cf7;
}

.requirement-input {
  resize: vertical;
  min-height: 60px;
  line-height: 1.6;
  font-family: inherit;
}

/* 岗位管理 */
.roles-group {
  flex: 1;
}

.roles-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 28px;
  padding: 4px 0;
}

.role-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 14px;
  font-size: 13px;
  background: #e8f0fe;
  color: #1a73e8;
}

.role-remove {
  background: none;
  border: none;
  color: #999;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0;
}

.role-remove:hover {
  color: #e74c3c;
}

.role-add-row {
  display: flex;
  gap: 8px;
}

.role-input {
  flex: 1;
  padding: 8px 10px;
  font-size: 13px;
}

.btn-add {
  padding: 8px 14px;
  border: 1px dashed #4a6cf7;
  border-radius: 6px;
  background: #f8f9ff;
  color: #4a6cf7;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s;
}

.btn-add:hover {
  background: #eef1ff;
}

/* 文件上传 */
.file-dropzone {
  border: 2px dashed #ddd;
  border-radius: 8px;
  padding: 18px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
}

.file-dropzone.drag-over {
  border-color: #4a6cf7;
  background: #f0f4ff;
}

.file-label {
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #888;
  font-size: 14px;
}

.file-icon {
  font-size: 20px;
}

.file-info {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  font-size: 14px;
  color: #333;
}

.btn-text {
  background: none;
  border: none;
  color: #e74c3c;
  cursor: pointer;
  font-size: 13px;
}

.btn-generate {
  width: 100%;
  padding: 12px;
  background: #4a6cf7;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-generate:hover:not(:disabled) {
  background: #3b5de7;
}

.btn-generate:disabled {
  background: #ccc;
  cursor: not-allowed;
}
</style>
