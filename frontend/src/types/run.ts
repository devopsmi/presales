import type { AnalysisPayload, RequirementNode } from './requirement'
import type { PricingPayload } from './pricing'

export interface RunResponse {
  id: string
  project_id: string
  task_type: string
  status: 'pending' | 'running' | 'succeeded' | 'failed'
  error_message: string | null
  analysis_payload: AnalysisPayload | null
  confirmed_requirements: RequirementNode[] | null
  pricing_payload: PricingPayload | null
  created_at: string
  updated_at: string
}
