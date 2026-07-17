import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as credentials from '@/api/credentials'
import * as client from '@/api/client'

vi.mock('@/api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}))

describe('credentials API', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('getActiveCredentials calls GET with projectId', async () => {
    ;(client.get as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: '1', name: 'key' }])
    await credentials.getActiveCredentials('proj-1')
    expect(client.get).toHaveBeenCalledWith('/api/v1/credentials/proj-1/credentials')
  })

  it('getActiveCredentials returns empty array on failure (silent fallback)', async () => {
    ;(client.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'))
    const result = await credentials.getActiveCredentials('proj-1')
    expect(result).toEqual([])
  })

  it('addCredential calls POST with name/type/key', async () => {
    await credentials.addCredential('proj-1', { name: 'test', type: 'api_key', key: 'secret' })
    expect(client.post).toHaveBeenCalledWith('/api/v1/credentials/proj-1/credentials', {
      name: 'test', type: 'api_key', key: 'secret',
    })
  })

  it('updateCredential calls PATCH with partial data', async () => {
    await credentials.updateCredential('proj-1', 'cred-1', { name: 'updated' })
    expect(client.patch).toHaveBeenCalledWith('/api/v1/credentials/proj-1/credentials/cred-1', {
      name: 'updated',
    })
  })

  it('deleteCredential calls DELETE', async () => {
    await credentials.deleteCredential('proj-1', 'cred-1')
    expect(client.del).toHaveBeenCalledWith('/api/v1/credentials/proj-1/credentials/cred-1')
  })
})
