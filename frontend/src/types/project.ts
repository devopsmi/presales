// 角色配置（JSON 内嵌在 project 中）
export interface RoleConfig {
  name: string
  unit_price_cents: number
  price_floor_cents: number
  price_ceiling_cents: number
  is_required: boolean
}

export interface Project {
  id: string
  name: string | null
  project_type: 'new' | 'legacy'
  target_gross_cents: number
  quote_company: string
  quote_date: string
  customer_name: string | null
  roles: RoleConfig[]
  stage: string
  selected_run_id: string | null
  selected_scenario_id: string | null
  created_at: string
  updated_at: string
}

export interface ProjectCreate {
  name?: string | null
  project_type: 'new' | 'legacy'
  target_price_wan: string
  quote_company?: string
  quote_date: string
  customer_name?: string | null
  roles?: RoleConfig[]
}

export interface ProjectUpdate {
  name?: string | null
  project_type?: 'new' | 'legacy'
  target_price_wan?: string
  quote_company?: string
  quote_date?: string
  customer_name?: string | null
  roles?: RoleConfig[]
}

export interface ProjectListResponse {
  items: Project[]
  total: number
  page: number
  page_size: number
}
