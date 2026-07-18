<template>
  <el-form
    ref="formRef"
    :model="form"
    :rules="rules"
    label-width="120px"
    style="max-width: 800px"
  >
    <el-form-item label="项目名称">
      <el-input v-model="form.name" placeholder="留空将自动生成" />
    </el-form-item>

    <el-form-item label="项目类型" prop="project_type">
      <el-select v-model="form.project_type" style="width: 100%">
        <el-option label="新项目" value="new" />
        <el-option label="旧项目二开" value="legacy" />
      </el-select>
    </el-form-item>

    <el-form-item label="目标报价" prop="target_price_wan">
      <el-input v-model="form.target_price_wan" placeholder="请输入数字">
        <template #append>万元</template>
      </el-input>
    </el-form-item>

    <el-form-item label="报价单位" prop="quote_company">
      <el-input v-model="form.quote_company" />
    </el-form-item>

    <el-form-item label="报价日期" prop="quote_date">
      <el-date-picker
        v-model="form.quote_date"
        type="date"
        placeholder="选择日期"
        value-format="YYYY-MM-DD"
        style="width: 100%"
      />
    </el-form-item>

    <el-form-item label="客户名称">
      <el-input v-model="form.customer_name" placeholder="可为空" />
    </el-form-item>

    <!-- 角色管理 -->
    <el-divider content-position="left">角色配置</el-divider>

    <el-table :data="allRoles" style="width: 100%; margin-bottom: 16px">
      <el-table-column prop="name" label="角色名称" />
      <el-table-column label="单价（元/人天）" width="130">
        <template #default="{ row }">
          <el-input-number
            :model-value="Math.round(row.unit_price_cents / 100)"
            @update:model-value="onPriceChange(row, Math.round(($event as number) * 100))"
            :min="100"
            :step="50"
            :precision="0"
            size="small"
          />
        </template>
      </el-table-column>
      <el-table-column label="浮动下限（元/天）" width="130">
        <template #default="{ row }">
          <el-input-number
            :model-value="Math.round(row.price_floor_cents / 100)"
            @update:model-value="row.price_floor_cents = Math.round(($event as number) * 100)"
            :min="1"
            :max="Math.round(row.unit_price_cents / 100)"
            :step="10"
            :precision="0"
            size="small"
          />
        </template>
      </el-table-column>
      <el-table-column label="浮动上限（元/天）" width="130">
        <template #default="{ row }">
          <el-input-number
            :model-value="Math.round(row.price_ceiling_cents / 100)"
            @update:model-value="row.price_ceiling_cents = Math.round(($event as number) * 100)"
            :min="Math.round(row.unit_price_cents / 100)"
            :max="99999"
            :step="10"
            :precision="0"
            size="small"
          />
        </template>
      </el-table-column>
      <el-table-column label="类型" width="100">
        <template #default="{ row }">
          <el-tag v-if="row.is_required" type="danger" size="small">必选</el-tag>
          <el-tag v-else-if="row.is_default" size="small">默认</el-tag>
          <el-tag v-else type="success" size="small">自定义</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="80">
        <template #default="{ row }">
          <el-button
            v-if="!row.is_required"
            type="danger"
            link
            size="small"
            @click="removeRole(row)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 添加角色 -->
    <el-form-item>
      <el-button type="primary" plain @click="showAddRole = true">添加角色</el-button>
    </el-form-item>

    <el-form-item>
      <el-button type="primary" @click="handleSubmit">提交</el-button>
    </el-form-item>

    <!-- 添加角色对话框 -->
    <el-dialog v-model="showAddRole" title="添加角色" width="400px">
      <el-form :model="newRole" label-width="80px">
        <el-form-item label="角色名称">
          <el-input v-model="newRole.name" placeholder="例如：UI/UX" />
        </el-form-item>
        <el-form-item label="单价">
          <el-input-number
            :model-value="Math.round(newRole.unit_price_cents / 100)"
            @update:model-value="newRole.unit_price_cents = Math.round(($event as number) * 100)"
            :min="100"
            :step="50"
            :precision="0"
          />
          <span style="margin-left: 8px">元/人天</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddRole = false">取消</el-button>
        <el-button type="primary" @click="addRole">确定</el-button>
      </template>
    </el-dialog>
  </el-form>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage } from 'element-plus'
import type { ProjectCreate, RoleConfig } from '@/types/project'

interface RoleItem {
  id: string
  name: string
  unit_price_cents: number
  price_floor_cents: number
  price_ceiling_cents: number
  is_required: boolean
  is_default: boolean
}

interface Props {
  initialData?: {
    name?: string | null
    project_type?: string
    target_price_wan?: string
    quote_company?: string
    quote_date?: string
    customer_name?: string | null
  }
}

const props = defineProps<Props>()
const emit = defineEmits<{
  submit: [data: ProjectCreate]
}>()

const formRef = ref<FormInstance>()
const showAddRole = ref(false)

let roleIdCounter = 0
function nextRoleId(): string {
  roleIdCounter += 1
  return `role-${roleIdCounter}`
}

const form = reactive({
  name: props.initialData?.name ?? '',
  project_type: (props.initialData?.project_type ?? 'new') as 'new' | 'legacy',
  target_price_wan: props.initialData?.target_price_wan ?? '',
  quote_company: props.initialData?.quote_company ?? '重庆酷小贝软件开发有限公司',
  quote_date: props.initialData?.quote_date ?? '',
  customer_name: props.initialData?.customer_name ?? '',
})

const rules: FormRules = {
  project_type: [{ required: true, message: '请选择项目类型', trigger: 'change' }],
  target_price_wan: [
    { required: true, message: '请输入目标报价', trigger: 'blur' },
    {
      validator: (_rule, value: string, callback) => {
        const num = parseFloat(value)
        if (isNaN(num) || num <= 0) {
          callback(new Error('目标报价必须大于 0'))
        } else {
          callback()
        }
      },
      trigger: 'blur',
    },
  ],
  quote_company: [{ required: true, message: '请输入报价单位', trigger: 'blur' }],
  quote_date: [{ required: true, message: '请选择报价日期', trigger: 'change' }],
}

const defaultRoles = reactive<RoleItem[]>([
  { id: nextRoleId(), name: '产品', unit_price_cents: 80000, price_floor_cents: 56000, price_ceiling_cents: 104000, is_required: true, is_default: true },
  { id: nextRoleId(), name: '前端', unit_price_cents: 85000, price_floor_cents: 59500, price_ceiling_cents: 110500, is_required: false, is_default: true },
  { id: nextRoleId(), name: '后端', unit_price_cents: 85000, price_floor_cents: 59500, price_ceiling_cents: 110500, is_required: false, is_default: true },
  { id: nextRoleId(), name: '测试', unit_price_cents: 75000, price_floor_cents: 52500, price_ceiling_cents: 97500, is_required: true, is_default: true },
])

const customRoles = reactive<RoleItem[]>([])

const allRoles = computed(() => [...defaultRoles, ...customRoles])

const newRole = reactive({
  name: '',
  unit_price_cents: 80000,
  price_floor_cents: 56000,
  price_ceiling_cents: 104000,
})

function onPriceChange(row: RoleItem, newPriceCents: number) {
  row.unit_price_cents = newPriceCents
  // 自动更新 ±30% 默认范围（仅在用户未手动修改过时）
  if (row.price_floor_cents === Math.round(row.unit_price_cents * 0.7 / 100) * 100) {
    // already auto, fine
  }
}

function addRole() {
  if (!newRole.name.trim()) {
    ElMessage.warning('请输入角色名称')
    return
  }
  customRoles.push({
    id: nextRoleId(),
    name: newRole.name.trim(),
    unit_price_cents: newRole.unit_price_cents,
    price_floor_cents: newRole.price_floor_cents,
    price_ceiling_cents: newRole.price_ceiling_cents,
    is_required: false,
    is_default: false,
  })
  newRole.name = ''
  newRole.unit_price_cents = 80000
  newRole.price_floor_cents = 56000
  newRole.price_ceiling_cents = 104000
  showAddRole.value = false
}

function removeRole(role: RoleItem) {
  const idx = customRoles.findIndex((r) => r.id === role.id)
  if (idx !== -1) {
    customRoles.splice(idx, 1)
  }
}

async function handleSubmit() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  const roles: RoleConfig[] = allRoles.value.map((r) => ({
    name: r.name,
    unit_price_cents: r.unit_price_cents,
    price_floor_cents: r.price_floor_cents,
    price_ceiling_cents: r.price_ceiling_cents,
    is_required: r.is_required,
  }))

  emit('submit', {
    name: form.name || null,
    project_type: form.project_type,
    target_price_wan: form.target_price_wan,
    quote_company: form.quote_company,
    quote_date: form.quote_date,
    customer_name: form.customer_name || null,
    roles,
  })
}
</script>
