import { get, post, put, del } from './client'

export interface ComputeNode {
  id: string
  hostname: string
  ssh_port: number
  ssh_user: string
  ssh_key_credential_id: string
  labels: Record<string, unknown>
  capacity: number
  status: 'online' | 'offline' | 'draining' | 'degraded'
  failure_count: number
  last_seen: string | null
  created_at: string
}

export interface TestConnectionResult {
  success: boolean
  error?: string
  failureCount?: number
}

export interface RunningContainer {
  id: string
  name: string
}

export function listComputeNodes(): Promise<ComputeNode[]> {
  return get('/api/v1/compute-nodes')
}

export function createComputeNode(data: {
  hostname: string
  ssh_port?: number
  ssh_user: string
  ssh_key_credential_id: string
  labels?: Record<string, unknown>
  capacity?: number
}): Promise<ComputeNode> {
  return post('/api/v1/compute-nodes', data)
}

export function updateComputeNode(id: string, data: Partial<ComputeNode>): Promise<ComputeNode> {
  return put(`/api/v1/compute-nodes/${id}`, data)
}

export function deleteComputeNode(id: string): Promise<void> {
  return del(`/api/v1/compute-nodes/${id}`)
}

export function testComputeNodeConnection(id: string): Promise<TestConnectionResult> {
  return post(`/api/v1/compute-nodes/${id}/test`)
}

export function getRunningContainers(_nodeId: string): Promise<RunningContainer[]> {
  // This would require a new endpoint, stubbed for now
  return Promise.resolve([])
}
