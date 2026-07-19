const BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

interface RequestOptions extends RequestInit {
  json?: unknown
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { json, ...fetchOptions } = options

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...fetchOptions,
    headers,
    body: json !== undefined ? JSON.stringify(json) : fetchOptions.body,
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}: ${errorBody || response.statusText}`)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

export const http = {
  get<T>(path: string): Promise<T> {
    return request<T>(path, { method: 'GET' })
  },

  post<T>(path: string, json: unknown): Promise<T> {
    return request<T>(path, { method: 'POST', json })
  },

  put<T>(path: string, json: unknown): Promise<T> {
    return request<T>(path, { method: 'PUT', json })
  },

  patch<T>(path: string, json: unknown): Promise<T> {
    return request<T>(path, { method: 'PATCH', json })
  },

  delete<T>(path: string): Promise<T> {
    return request<T>(path, { method: 'DELETE' })
  },

  /** 下载 blob（文件导出） */
  async downloadBlob(path: string, filename?: string): Promise<void> {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'GET',
    })
    if (!response.ok) {
      const errorBody = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status}: ${errorBody || response.statusText}`)
    }
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename || path.split('/').pop() || 'download'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  },
}