import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as computeNodes from '@/api/computeNodes'
import * as client from '@/api/client'

vi.mock('@/api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}))

describe('computeNodes API', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('listComputeNodes calls GET /api/v1/compute-nodes', async () => {
    await computeNodes.listComputeNodes()
    expect(client.get).toHaveBeenCalledWith('/api/v1/compute-nodes')
  })

  it('createComputeNode calls POST with correct body', async () => {
    await computeNodes.createComputeNode({
      hostname: '1.2.3.4',
      ssh_user: 'ubuntu',
      ssh_key_credential_id: 'key-1',
    })
    expect(client.post).toHaveBeenCalledWith('/api/v1/compute-nodes', {
      hostname: '1.2.3.4',
      ssh_user: 'ubuntu',
      ssh_key_credential_id: 'key-1',
    })
  })

  it('updateComputeNode calls PUT with id in path', async () => {
    await computeNodes.updateComputeNode('node-1', { status: 'draining' })
    expect(client.put).toHaveBeenCalledWith('/api/v1/compute-nodes/node-1', { status: 'draining' })
  })

  it('deleteComputeNode calls DELETE', async () => {
    await computeNodes.deleteComputeNode('node-1')
    expect(client.del).toHaveBeenCalledWith('/api/v1/compute-nodes/node-1')
  })

  it('testComputeNodeConnection calls POST /:id/test', async () => {
    await computeNodes.testComputeNodeConnection('node-1')
    expect(client.post).toHaveBeenCalledWith('/api/v1/compute-nodes/node-1/test')
  })

  it('getRunningContainers returns empty array (stub)', async () => {
    const result = await computeNodes.getRunningContainers('node-1')
    expect(result).toEqual([])
  })
})
