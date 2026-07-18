export interface QuoteLine {
  work_package_id: string | null
  work_package_name: string | null
  role: string
  unit_price_cents: number
  half_day_units: number
}

export interface QuotePlan {
  id: string
  kind: 'recommended' | 'adjusted' | 'closest'
  lines: QuoteLine[]
  labor_cents: number
  tax_cents: number
  gross_cents: number
  within_target: boolean
  adjustments: string[]
}

export interface PricingPayload {
  target_gross_cents: number
  plans: QuotePlan[]
}
