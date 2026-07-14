import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as client from '@/api/client'
import * as providersApi from '@/api/providers'

describe('providersApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('listProviders calls GET /api/v1/providers without projectId', async () => {
    vi.spyOn(client, 'get').mockResolvedValue([{ id: '1', name: 'Test' }])
    await providersApi.listProviders()
    expect(client.get).toHaveBeenCalledWith('/api/v1/providers')
  })

  it('listProviders returns empty array on error', async () => {
    vi.spyOn(client, 'get').mockRejectedValue(new Error('fail'))
    const result = await providersApi.listProviders()
    expect(result).toEqual([])
  })

  it('addProvider calls POST /api/v1/providers', async () => {
    vi.spyOn(client, 'post').mockResolvedValue({ id: '1', name: 'New' })
    await providersApi.addProvider({ name: 'New', providerType: 'claude' })
    expect(client.post).toHaveBeenCalledWith('/api/v1/providers', { name: 'New', providerType: 'claude' })
  })

  it('getProvider calls GET /api/v1/providers/:id', async () => {
    vi.spyOn(client, 'get').mockResolvedValue({ id: '1', name: 'Test' })
    await providersApi.getProvider('1')
    expect(client.get).toHaveBeenCalledWith('/api/v1/providers/1')
  })

  it('updateProvider calls PATCH /api/v1/providers/:id', async () => {
    vi.spyOn(client, 'patch').mockResolvedValue({ id: '1', name: 'Updated' })
    await providersApi.updateProvider('1', { name: 'Updated' })
    expect(client.patch).toHaveBeenCalledWith('/api/v1/providers/1', { name: 'Updated' })
  })

  it('deleteProvider calls DELETE /api/v1/providers/:id', async () => {
    vi.spyOn(client, 'del').mockResolvedValue(undefined)
    await providersApi.deleteProvider('1')
    expect(client.del).toHaveBeenCalledWith('/api/v1/providers/1')
  })

  it('testProvider calls POST /api/v1/providers/:id/test', async () => {
    vi.spyOn(client, 'post').mockResolvedValue({ success: true, valid: true, message: 'OK' })
    await providersApi.testProvider('1')
    expect(client.post).toHaveBeenCalledWith('/api/v1/providers/1/test')
  })

  it('setDirector calls PATCH /api/v1/providers/:id/directorship', async () => {
    vi.spyOn(client, 'patch').mockResolvedValue({ id: '1', is_project_director: true })
    await providersApi.setDirector('1')
    expect(client.patch).toHaveBeenCalledWith('/api/v1/providers/1/directorship')
  })

  it('getProviderAgents calls GET /api/v1/providers/:id/agents', async () => {
    vi.spyOn(client, 'get').mockResolvedValue([{ id: '1', name: 'Agent' }])
    await providersApi.getProviderAgents('1')
    expect(client.get).toHaveBeenCalledWith('/api/v1/providers/1/agents')
  })

  it('resolveProvider calls POST /api/v1/providers/resolve', async () => {
    vi.spyOn(client, 'post').mockResolvedValue({ provider: 'claude', model: 'gpt-4o' })
    await providersApi.resolveProvider({ labels: ['frontend'], priority: 'high' })
    expect(client.post).toHaveBeenCalledWith('/api/v1/providers/resolve', { labels: ['frontend'], priority: 'high' })
  })
})
