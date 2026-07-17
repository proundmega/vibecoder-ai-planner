import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as review from '@/api/review'
import * as client from '@/api/client'

vi.mock('@/api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
}))

describe('review API', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('getGithubDiff calls GET /:ticketId/review/diff', async () => {
    await review.getGithubDiff('t-1')
    expect(client.get).toHaveBeenCalledWith('/api/v1/tickets/t-1/review/diff')
  })

  it('getLocalDiff unwraps { files } envelope to return files array', async () => {
    const mockData = { files: [{ path: 'a.ts', action: 'added' }] }
    ;(client.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockData)
    const result = await review.getLocalDiff('t-1')
    expect(client.get).toHaveBeenCalledWith('/api/v1/tickets/t-1/review/local-diff')
    expect(result).toEqual([{ path: 'a.ts', action: 'added' }])
  })

  it('getComments calls GET with type query param defaulting to review', async () => {
    await review.getComments('t-1')
    expect(client.get).toHaveBeenCalledWith('/api/v1/tickets/t-1/comments?type=review')
  })

  it('getComments passes custom type param', async () => {
    await review.getComments('t-1', 'suggestion')
    expect(client.get).toHaveBeenCalledWith('/api/v1/tickets/t-1/comments?type=suggestion')
  })

  it('postComment calls POST with content/line/type', async () => {
    await review.postComment('t-1', { content: 'Nice code', line: 42, type: 'review' })
    expect(client.post).toHaveBeenCalledWith('/api/v1/tickets/t-1/comments', {
      content: 'Nice code',
      line: 42,
      type: 'review',
    })
  })
})
