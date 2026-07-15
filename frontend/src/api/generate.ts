import axios from 'axios'
import type { GenerateResponse, EstimateTask, Summary, GenerateFormData } from '@/types'

const http = axios.create({
  baseURL: '/api',
  timeout: 0, // 不设超时，LLM 生成可能耗时较长
})

/**
 * 调用方案生成 API。
 */
export async function generateDesign(
  data: GenerateFormData,
  file?: File,
): Promise<GenerateResponse> {
  const form = new FormData()
  form.append('requirement', data.requirement)
  form.append('company_name', data.companyName)
  form.append('project_name', data.projectName)
  form.append('quotation_unit', data.quotationUnit)
  form.append('max_budget', String(data.maxBudget))
  form.append('roles', JSON.stringify(data.roles))
  if (file) {
    form.append('file', file)
  }

  const resp = await http.post<GenerateResponse>('/generate', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return resp.data
}

/**
 * 导出设计方案为 Word 文档。
 */
export async function exportDesignDocx(markdown: string) {
  const form = new FormData()
  form.append('markdown', markdown)

  const resp = await http.post('/export/design', form, {
    responseType: 'blob',
  })
  triggerDownload(resp.data, 'design_document.docx')
}

/**
 * 导出报价单为 Excel 文件。
 */
export async function exportEstimateXlsx(
  tasks: EstimateTask[],
  summary: Summary,
  companyName: string = '',
  projectName: string = '',
  quotationUnit: string = '',
) {
  const form = new FormData()
  form.append('tasks', JSON.stringify(tasks))
  form.append('summary', JSON.stringify(summary))
  form.append('company_name', companyName)
  form.append('project_name', projectName)
  form.append('quotation_unit', quotationUnit)

  const resp = await http.post('/export/estimate', form, {
    responseType: 'blob',
  })
  triggerDownload(resp.data, 'quotation.xlsx')
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
