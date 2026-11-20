import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}))

import * as client from '@/api/client'
import * as registryApi from '@/api/providerRegistry'

describe('providerRegistry API client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists and creates credentials', async () => {
    ;(client.get as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(client.post as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1 })

    await registryApi.listCredentials()
    await registryApi.createCredential({
      name: 'Acme',
      providerType: 'openai',
      apiKey: 'sk-secret',
      baseUrl: 'https://api.example.com',
      projectId: 5,
    })

    expect(client.get).toHaveBeenCalledWith('/api/v1/provider-credentials')
    expect(client.post).toHaveBeenCalledWith('/api/v1/provider-credentials', {
      name: 'Acme',
      providerType: 'openai',
      apiKey: 'sk-secret',
      baseUrl: 'https://api.example.com',
      projectId: 5,
    })
  })

  it('updates and deletes credentials', async () => {
    ;(client.patch as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1 })
    ;(client.del as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

    await registryApi.updateCredential(1, { name: 'Acme rotated', apiKey: 'sk-new' })
    await registryApi.deleteCredential(1)

    expect(client.patch).toHaveBeenCalledWith('/api/v1/provider-credentials/1', {
      name: 'Acme rotated',
      apiKey: 'sk-new',
    })
    expect(client.del).toHaveBeenCalledWith('/api/v1/provider-credentials/1')
  })

  it('keeps reference lists from a 409 delete', async () => {
    const inUse = Object.assign(new Error('in use'), {
      status: 409,
      details: {
        referencingRuntimes: [{ id: 1, name: 'worker-1' }],
        referencingModels: [{ id: 10, model: 'gpt-4o' }],
      },
    })
    ;(client.del as ReturnType<typeof vi.fn>).mockRejectedValue(inUse)

    await expect(registryApi.deleteCredential(1)).rejects.toMatchObject({
      status: 409,
      referencingRuntimes: [{ id: 1, name: 'worker-1' }],
      referencingModels: [{ id: 10, model: 'gpt-4o' }],
    })
  })

  it('discovers and adds models on a credential', async () => {
    ;(client.post as ReturnType<typeof vi.fn>).mockResolvedValue([])

    await registryApi.discoverModels(1)
    await registryApi.addModel(1, { model: 'gpt-4o', roles: ['worker'], effort: 'medium' })

    expect(client.post).toHaveBeenCalledWith('/api/v1/provider-credentials/1/discover')
    expect(client.post).toHaveBeenCalledWith('/api/v1/provider-credentials/1/models', {
      model: 'gpt-4o',
      roles: ['worker'],
      effort: 'medium',
    })
  })

  it('tests and patches models', async () => {
    ;(client.post as ReturnType<typeof vi.fn>).mockResolvedValue({ verified: true, latencyMs: 42 })
    ;(client.patch as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 10 })

    await registryApi.testModel(10)
    await registryApi.updateModel(10, { status: 'disabled', effort: 'max' })

    expect(client.post).toHaveBeenCalledWith('/api/v1/provider-models/10/test')
    expect(client.patch).toHaveBeenCalledWith('/api/v1/provider-models/10', {
      status: 'disabled',
      effort: 'max',
    })
  })
})
