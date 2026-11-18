import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
}))

import * as enrollmentApi from '@/api/agentEnrollment'
import * as client from '@/api/client'

describe('agentEnrollment API client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('mints a token with the snake_case contract', async () => {
    ;(client.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 1,
      token: 'enr_once',
      expires_at: '2026-01-01T00:00:00Z',
    })

    const result = await enrollmentApi.mintEnrollmentToken({
      projectId: 3,
      name: 'node-1',
      ttlSeconds: 900,
      maxUses: 2,
      providerId: 4,
    })

    expect(client.post).toHaveBeenCalledWith('/api/v1/agent-enrollment/tokens', {
      project_id: 3,
      name: 'node-1',
      ttl_seconds: 900,
      max_uses: 2,
      provider_id: 4,
    })
    expect(result.token).toBe('enr_once')
  })

  it('lists and revokes tokens by id', async () => {
    ;(client.get as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(client.del as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 9 })

    await enrollmentApi.listEnrollmentTokens(3)
    await enrollmentApi.revokeEnrollmentToken(9)

    expect(client.get).toHaveBeenCalledWith('/api/v1/agent-enrollment/tokens?project_id=3')
    expect(client.del).toHaveBeenCalledWith('/api/v1/agent-enrollment/tokens/9')
  })
})
