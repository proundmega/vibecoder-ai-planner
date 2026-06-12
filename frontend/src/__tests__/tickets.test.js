import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as tickets from '../api/tickets'

vi.mock('../api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}))

describe('tickets API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetchTickets calls get with correct URL', async () => {
    const { get } = await import('../api/client')
    get.mockResolvedValue([{ id: 't1' }, { id: 't2' }])

    const result = await tickets.fetchTickets('proj-1')

    expect(get).toHaveBeenCalledWith('/api/projects/proj-1/tickets')
    expect(result).toEqual([{ id: 't1' }, { id: 't2' }])
  })

  it('fetchTickets returns empty array on error', async () => {
    const { get } = await import('../api/client')
    get.mockRejectedValue(new Error('Network error'))

    const result = await tickets.fetchTickets('proj-1')

    expect(result).toEqual([])
  })

  it('fetchTicket calls get with correct URL', async () => {
    const { get } = await import('../api/client')
    get.mockResolvedValue({ id: 't1', title: 'Test ticket' })

    const result = await tickets.fetchTicket('t1')

    expect(get).toHaveBeenCalledWith('/api/tickets/t1')
    expect(result).toEqual({ id: 't1', title: 'Test ticket' })
  })

  it('fetchTicket returns null on error', async () => {
    const { get } = await import('../api/client')
    get.mockRejectedValue(new Error('Not found'))

    const result = await tickets.fetchTicket('t1')

    expect(result).toBeNull()
  })

  it('updateTicket calls put with correct URL and body', async () => {
    const { put } = await import('../api/client')
    put.mockResolvedValue({ id: 't1', status: 'in_progress' })

    const result = await tickets.updateTicket('t1', { status: 'in_progress' })

    expect(put).toHaveBeenCalledWith('/api/tickets/t1', { status: 'in_progress' })
    expect(result).toEqual({ id: 't1', status: 'in_progress' })
  })

  it('updateTicket returns null on error', async () => {
    const { put } = await import('../api/client')
    put.mockRejectedValue(new Error('Update failed'))

    const result = await tickets.updateTicket('t1', { status: 'in_progress' })

    expect(result).toBeNull()
  })

  it('createTicket calls post with correct URL and body', async () => {
    const { post } = await import('../api/client')
    post.mockResolvedValue({ id: 't1', title: 'New ticket' })

    const result = await tickets.createTicket('proj-1', 'New ticket', 'Description')

    expect(post).toHaveBeenCalledWith('/api/tickets', {
      projectId: 'proj-1',
      title: 'New ticket',
      description: 'Description',
    })
    expect(result).toEqual({ id: 't1', title: 'New ticket' })
  })

  it('createTicket returns null on error', async () => {
    const { post } = await import('../api/client')
    post.mockRejectedValue(new Error('Create failed'))

    const result = await tickets.createTicket('proj-1', 'New ticket', 'Description')

    expect(result).toBeNull()
  })

  it('deleteTicket calls del with correct URL', async () => {
    const { del } = await import('../api/client')
    del.mockResolvedValue({ deleted: true })

    const result = await tickets.deleteTicket('t1')

    expect(del).toHaveBeenCalledWith('/api/tickets/t1')
    expect(result).toEqual({ deleted: true })
  })

  it('deleteTicket throws on error (not swallowed)', async () => {
    const { del } = await import('../api/client')
    del.mockRejectedValue(new Error('Delete failed'))

    await expect(tickets.deleteTicket('t1')).rejects.toThrow('Delete failed')
  })

  it('fetchComments calls get with correct URL', async () => {
    const { get } = await import('../api/client')
    get.mockResolvedValue([{ id: 'c1', content: 'Comment 1' }])

    const result = await tickets.fetchComments('t1')

    expect(get).toHaveBeenCalledWith('/api/tickets/t1/comments')
    expect(result).toEqual([{ id: 'c1', content: 'Comment 1' }])
  })

  it('fetchComments returns empty array on error', async () => {
    const { get } = await import('../api/client')
    get.mockRejectedValue(new Error('Network error'))

    const result = await tickets.fetchComments('t1')

    expect(result).toEqual([])
  })

  it('addComment calls post with correct URL and body', async () => {
    const { post } = await import('../api/client')
    post.mockResolvedValue({ id: 'c1', content: 'New comment' })

    const result = await tickets.addComment('t1', 'New comment')

    expect(post).toHaveBeenCalledWith('/api/tickets/t1/comments', { content: 'New comment' })
    expect(result).toEqual({ id: 'c1', content: 'New comment' })
  })

  it('addComment returns null on error', async () => {
    const { post } = await import('../api/client')
    post.mockRejectedValue(new Error('Comment failed'))

    const result = await tickets.addComment('t1', 'New comment')

    expect(result).toBeNull()
  })

  it('fetchProjectUsers calls get with correct URL', async () => {
    const { get } = await import('../api/client')
    get.mockResolvedValue([{ id: 'u1', name: 'User 1' }])

    const result = await tickets.fetchProjectUsers('proj-1')

    expect(get).toHaveBeenCalledWith('/api/projects/proj-1/users')
    expect(result).toEqual([{ id: 'u1', name: 'User 1' }])
  })

  it('fetchProjectUsers returns empty array on error', async () => {
    const { get } = await import('../api/client')
    get.mockRejectedValue(new Error('Network error'))

    const result = await tickets.fetchProjectUsers('proj-1')

    expect(result).toEqual([])
  })
})
