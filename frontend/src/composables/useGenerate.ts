import { ref } from 'vue'
import { generateDesign } from '@/api/generate'
import type { GenerateResponse, GenerateFormData } from '@/types'

export function useGenerate() {
  const loading = ref(false)
  const error = ref<string | null>(null)
  const result = ref<GenerateResponse | null>(null)

  async function generate(data: GenerateFormData, file?: File) {
    loading.value = true
    error.value = null
    result.value = null

    try {
      result.value = await generateDesign(data, file)
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.message || '生成失败，请稍后重试'
      error.value = msg
    } finally {
      loading.value = false
    }
  }

  function reset() {
    loading.value = false
    error.value = null
    result.value = null
  }

  return { loading, error, result, generate, reset }
}
