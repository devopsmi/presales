/** 方案生成请求参数（不含文件） */
export interface GenerateFormData {
  requirement: string
  companyName: string
  projectName: string
  quotationUnit: string
  maxBudget: number
  roles: string[]
}

/** API 生成请求参数 */
export interface GenerateRequest extends GenerateFormData {
  file?: File
}

/** 单个开发任务（对应报价单模板中的一行） */
export interface EstimateTask {
  serial: number
  module: string
  sub_module: string
  feature: string
  processor: string
  description: string
  backend_days: number
  frontend_days: number
  test_days: number
  remark: string
}

/** 预算汇总统计（匹配模板底部） */
export interface Summary {
  total_backend_days: number
  total_frontend_days: number
  total_test_days: number
  backend_daily_rate: number
  frontend_daily_rate: number
  test_daily_rate: number
  backend_cost: number
  frontend_cost: number
  test_cost: number
  total_labor_cost: number
  management_fee_rate: number
  tax_rate: number
  management_fee: number
  tax: number
  grand_total: number
}

/** 预算估算结果 */
export interface EstimateResult {
  tasks: EstimateTask[]
  summary: Summary
}

/** 设计方案结果 */
export interface DesignResult {
  markdown: string
}

/** 审核问题 */
export interface ReviewIssue {
  type: string
  detail: string
  suggestion: string
}

/** 审核结果 */
export interface ReviewResult {
  passed: boolean
  issues: ReviewIssue[]
  summary: string
}

/** 完整的 API 响应 */
export interface GenerateResponse {
  design: DesignResult
  estimate: EstimateResult
  review: ReviewResult
}
