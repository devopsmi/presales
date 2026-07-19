import { http } from './http'
import type { Project, ProjectCreate, ProjectListResponse, ProjectUpdate } from '@/types/project'

export function getProjects(page = 1, pageSize = 20): Promise<ProjectListResponse> {
  return http.get(`/api/v1/projects?page=${page}&page_size=${pageSize}`)
}

export function getProject(id: string): Promise<Project> {
  return http.get(`/api/v1/projects/${id}`)
}

export function createProject(data: ProjectCreate): Promise<Project> {
  return http.post('/api/v1/projects', data)
}

export function updateProject(id: string, data: ProjectUpdate): Promise<Project> {
  return http.patch(`/api/v1/projects/${id}`, data)
}

export function deleteProject(id: string): Promise<void> {
  return http.delete(`/api/v1/projects/${id}`)
}

export function exportQuote(projectId: string, projectName?: string): Promise<void> {
  const filename = `报价单_${projectName || projectId.slice(0, 8)}.xlsx`
  return http.downloadBlob(`/api/v1/projects/${projectId}/export-quote`, filename)
}