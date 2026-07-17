import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as milestones from '@/api/milestones'
import * as client from '@/api/client'

vi.mock('@/api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}))

describe('milestones API', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('listMilestones calls GET with projectId', async () => {
    await milestones.listMilestones('proj-1')
    expect(client.get).toHaveBeenCalledWith('/api/v1/projects/proj-1/milestones')
  })

  it('createMilestone calls POST with name/description/targetDate', async () => {
    await milestones.createMilestone('proj-1', {
      name: 'v1.0',
      description: 'First release',
      target_date: '2026-08-01',
    })
    expect(client.post).toHaveBeenCalledWith('/api/v1/projects/proj-1/milestones', {
      name: 'v1.0',
      description: 'First release',
      target_date: '2026-08-01',
    })
  })

  it('updateMilestone calls PUT with id in path', async () => {
    await milestones.updateMilestone('ms-1', { name: 'Updated' })
    expect(client.put).toHaveBeenCalledWith('/api/v1/milestones/ms-1', { name: 'Updated' })
  })

  it('getMilestoneProgress calls GET /:id/progress', async () => {
    await milestones.getMilestoneProgress('ms-1')
    expect(client.get).toHaveBeenCalledWith('/api/v1/milestones/ms-1/progress')
  })

  it('getMilestoneTickets calls GET /:id/tickets', async () => {
    await milestones.getMilestoneTickets('ms-1')
    expect(client.get).toHaveBeenCalledWith('/api/v1/milestones/ms-1/tickets')
  })
})
