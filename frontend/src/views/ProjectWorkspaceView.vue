<template>
  <div v-loading="loading">
    <template v-if="isCreating">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px">
        <h2 style="margin: 0">新建项目</h2>
        <div>
          <el-button @click="router.push('/projects')">返回列表</el-button>
        </div>
      </div>
      <ProjectForm @submit="handleCreate" />
    </template>

    <template v-else-if="project">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px">
        <h2 style="margin: 0">{{ project.name || '(未命名)' }}</h2>
        <div>
          <el-button @click="router.push('/projects')">返回列表</el-button>
          <el-button type="primary" @click="showEdit = true">编辑</el-button>
          <el-button type="danger" plain @click="handleDelete">删除</el-button>
        </div>
      </div>

      <el-steps :active="activeStep" finish-status="success" style="margin-bottom: 24px">
        <el-step title="参数与材料" />
        <el-step title="需求草稿" />
        <el-step title="工时与报价" />
        <el-step title="文件导出" />
      </el-steps>

      <el-card v-if="activeStep === 0" style="margin-bottom: 20px">
        <template #header>
          <span>项目信息</span>
        </template>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="项目名称">{{ project.name || '(未命名)' }}</el-descriptions-item>
          <el-descriptions-item label="项目类型">
            {{ project.project_type === 'new' ? '新项目' : '旧项目二开' }}
          </el-descriptions-item>
          <el-descriptions-item label="目标报价">{{ formatWan(project.target_gross_cents) }}</el-descriptions-item>
          <el-descriptions-item label="报价单位">{{ project.quote_company }}</el-descriptions-item>
          <el-descriptions-item label="报价日期">{{ project.quote_date }}</el-descriptions-item>
          <el-descriptions-item label="客户名称">{{ project.customer_name || '-' }}</el-descriptions-item>
          <el-descriptions-item label="阶段">{{ stageLabel(project.stage) }}</el-descriptions-item>
        </el-descriptions>
      </el-card>

      <ProjectSetupStep
        v-if="activeStep === 0"
        :project-id="project.id"
        @analysis-done="onAnalysisDone"
      />

      <RequirementDraftEditor
        v-if="activeStep === 1 && analysisRun"
        :project-id="project.id"
        :analysis-payload="analysisRun.analysis_payload!"
        @confirmed="onConfirmed"
      />

      <PricingStep
        v-if="activeStep === 2"
        :plans="pricingPlans"
        :loading="pricingLoading"
        :project-id="project.id"
        :run-id="pricingRunId"
        @selected="onScenarioSelected"
      />

      <div v-if="activeStep === 3" style="text-align: center; padding: 40px; color: #999">
        文件导出（待 Task 4 实现）
      </div>
    </template>

    <el-dialog v-model="showEdit" title="编辑项目" width="500px">
      <el-form :model="editForm" label-width="100px">
        <el-form-item label="项目名称">
          <el-input v-model="editForm.name" placeholder="请输入项目名称" />
        </el-form-item>
        <el-form-item label="客户名称">
          <el-input v-model="editForm.customer_name" placeholder="请输入客户名称" />
        </el-form-item>
        <el-form-item label="目标报价">
          <el-input v-model="editForm.target_price_wan" placeholder="万元">
            <template #append>万元</template>
          </el-input>
        </el-form-item>
        <el-form-item label="报价单位">
          <el-input v-model="editForm.quote_company" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEdit = false">取消</el-button>
        <el-button type="primary" @click="handleUpdate">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getProject, createProject, updateProject, deleteProject } from '@/api/projects'
import ProjectForm from '@/components/ProjectForm.vue'
import ProjectSetupStep from '@/components/ProjectSetupStep.vue'
import RequirementDraftEditor from '@/components/RequirementDraftEditor.vue'
import PricingStep from '@/components/PricingStep.vue'
import type { Project, ProjectCreate } from '@/types/project'
import type { RunResponse } from '@/types/run'
import type { QuotePlan } from '@/types/pricing'
import { startPricingRun, selectScenario, getRun } from '@/api/runs'

const route = useRoute()
const router = useRouter()
const project = ref<Project | null>(null)
const loading = ref(false)
const showEdit = ref(false)
const activeStep = ref(0)
const analysisRun = ref<RunResponse | null>(null)
const pricingPlans = ref<QuotePlan[]>([])
const pricingLoading = ref(false)
const pricingRunId = ref<string | null>(null)

const isCreating = computed(() => route.params.id === 'new')

const editForm = reactive({
  name: '',
  customer_name: '',
  target_price_wan: '',
  quote_company: '',
})

const STAGE_MAP: Record<string, string> = {
  input: '录入中',
  draft_ready: '草稿就绪',
  quote_ready: '方案就绪',
  completed: '已完成',
}

function stageLabel(stage: string): string {
  return STAGE_MAP[stage] || stage
}

function formatWan(cents: number): string {
  return `${(cents / 100 / 10000).toFixed(2)} 万元`
}

async function loadProject() {
  const id = route.params.id as string
  if (!id || id === 'new') return
  loading.value = true
  try {
    project.value = await getProject(id)
    editForm.name = project.value.name || ''
    editForm.customer_name = project.value.customer_name || ''
    editForm.target_price_wan = (project.value.target_gross_cents / 100 / 10000).toString()
    editForm.quote_company = project.value.quote_company

    if (project.value.stage === 'draft_ready') activeStep.value = 1
    else if (project.value.stage === 'quote_ready') activeStep.value = 2
    else if (project.value.stage === 'completed') activeStep.value = 3
    else activeStep.value = 0
  } finally {
    loading.value = false
  }
}

async function handleCreate(data: ProjectCreate) {
  try {
    const created = await createProject(data)
    ElMessage.success('项目创建成功')
    router.push(`/projects/${created.id}`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '创建失败')
  }
}

async function handleUpdate() {
  if (!project.value) return
  try {
    await updateProject(project.value.id, {
      name: editForm.name || null,
      customer_name: editForm.customer_name || null,
      target_price_wan: editForm.target_price_wan,
      quote_company: editForm.quote_company,
    })
    ElMessage.success('更新成功')
    showEdit.value = false
    await loadProject()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '更新失败')
  }
}

async function handleDelete() {
  if (!project.value) return
  try {
    await ElMessageBox.confirm('确定要删除该项目吗？', '确认删除', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await deleteProject(project.value.id)
    ElMessage.success('删除成功')
    router.push('/projects')
  } catch {
    // ignore cancel
  }
}

function onAnalysisDone(run: RunResponse) {
  analysisRun.value = run
  activeStep.value = 1
}

function onConfirmed() {
  activeStep.value = 2
  ElMessage.success('已进入报价阶段')
  startPricing()
}

async function startPricing() {
  if (!project.value) return
  pricingLoading.value = true
  pricingPlans.value = []
  try {
    const { run_id } = await startPricingRun(project.value.id)
    pricingRunId.value = run_id
    // 轮询定价结果
    const poll = setInterval(async () => {
      try {
        const run = await getRun(run_id)
        if (run.status === 'succeeded') {
          clearInterval(poll)
          pricingLoading.value = false
          pricingPlans.value = run.pricing_payload?.plans || []
          // 刷新项目信息以更新 stage
          project.value = await getProject(project.value!.id)
        } else if (run.status === 'failed') {
          clearInterval(poll)
          pricingLoading.value = false
          ElMessage.error(`报价生成失败: ${run.error_message || '未知错误'}`)
        }
      } catch {
        clearInterval(poll)
        pricingLoading.value = false
        ElMessage.error('查询任务状态失败')
      }
    }, 1000)
  } catch (err) {
    pricingLoading.value = false
    ElMessage.error(err instanceof Error ? err.message : '启动报价失败')
  }
}

async function onScenarioSelected(planId: string, runId: string) {
  if (!project.value) return
  try {
    await selectScenario(project.value.id, runId, planId)
    ElMessage.success('方案已确认')
    project.value = await getProject(project.value.id)
    activeStep.value = 3
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '方案确认失败')
  }
}

onMounted(loadProject)
</script>
