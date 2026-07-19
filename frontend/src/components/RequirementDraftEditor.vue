<template>
  <div>
    <el-alert
      v-if="conflicts.length > 0"
      :title="`检测到 ${conflicts.length} 处描述冲突`"
      type="warning"
      :description="conflicts[0]"
      show-icon
      style="margin-bottom: 16px"
      closable
    />

    <el-alert
      v-if="unansweredQuestions.length > 0"
      :title="`${unansweredQuestions.length} 个待确认问题`"
      type="info"
      show-icon
      style="margin-bottom: 16px"
      closable
    >
      <template #default>
        <ul style="margin: 4px 0">
          <li v-for="q in unansweredQuestions" :key="q">{{ q }}</li>
        </ul>
      </template>
    </el-alert>

    <el-table :data="editableItems" style="width: 100%" max-height="500px">
      <el-table-column prop="module" label="模块" width="140">
        <template #default="{ row }">
          <el-input v-model="row.module" size="small" v-if="!readonly" />
          <span v-else>{{ row.module }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="feature" label="功能" width="140">
        <template #default="{ row }">
          <el-input v-model="row.feature" size="small" v-if="!readonly" />
          <span v-else>{{ row.feature }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="subfeature" label="子功能" width="140">
        <template #default="{ row }">
          <el-input v-model="row.subfeature" size="small" v-if="!readonly" />
          <span v-else>{{ row.subfeature }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="description" label="描述" min-width="200">
        <template #default="{ row }">
          <el-input v-model="row.description" type="textarea" :rows="2" size="small" v-if="!readonly" />
          <span v-else>{{ row.description }}</span>
        </template>
      </el-table-column>
      <el-table-column label="角色" width="200">
        <template #default="{ row }">
          <template v-if="readonly">
            <el-tag v-for="role in row.suggested_roles" :key="role" size="small" style="margin-right: 4px">
              {{ role }}
            </el-tag>
          </template>
          <el-select
            v-else
            v-model="row.suggested_roles"
            multiple
            placeholder="选择角色"
            size="small"
            style="width: 100%"
          >
            <el-option label="产品" value="产品" />
            <el-option label="前端" value="前端" />
            <el-option label="后端" value="后端" />
            <el-option label="测试" value="测试" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column prop="complexity_weight" label="权重" width="80">
        <template #default="{ row }">
          <el-input-number v-model="row.complexity_weight" :min="1" :max="5" size="small" v-if="!readonly" />
          <span v-else>{{ row.complexity_weight }}</span>
        </template>
      </el-table-column>
      <el-table-column label="标记" width="100">
        <template #default="{ row }">
          <el-tag v-if="row.system_added" type="warning" size="small">系统补充</el-tag>
          <el-tag v-if="row.pending_confirmation" type="info" size="small">待确认</el-tag>
        </template>
      </el-table-column>
    </el-table>

    <div style="margin-top: 16px; text-align: right">
      <el-button type="primary" :loading="confirming" @click="handleConfirm" v-if="!readonly">
        确认需求快照
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import type { RequirementNode } from '@/types/requirement'
import { confirmRequirements } from '@/api/runs'

const props = defineProps<{
  projectId: string
  analysisPayload: {
    overview: string
    requirements: RequirementNode[]
    conflicts: string[]
    unanswered_questions: string[]
    suggested_project_name?: string | null
  }
  readonly?: boolean
}>()

const emit = defineEmits<{
  confirmed: []
}>()

const conflicts = ref<string[]>(props.analysisPayload.conflicts || [])
const unansweredQuestions = ref<string[]>(props.analysisPayload.unanswered_questions || [])
const confirming = ref(false)

// 可编辑的表格数据
const editableItems = reactive<RequirementNode[]>(
  JSON.parse(JSON.stringify(props.analysisPayload.requirements))
)

async function handleConfirm() {
  confirming.value = true
  try {
    await confirmRequirements(props.projectId, editableItems)
    ElMessage.success('需求已确认')
    emit('confirmed')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '确认失败')
  } finally {
    confirming.value = false
  }
}
</script>
