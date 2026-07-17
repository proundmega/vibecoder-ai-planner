import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as deployments from '@/api/deployments'
import * as client from '@/api/client'

vi.mock('@/api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  patch: vi.fn(),
}))

describe('deployments API', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('listEnvironments calls GET with projectId', async () => {
    await deployments.listEnvironments('proj-1')
    expect(client.get).toHaveBeenCalledWith('/api/v1/projects/proj-1/environments')
  })

  it('createEnvironment calls POST with name/webhook_url/branch_pattern', async () => {
    await deployments.createEnvironment('proj-1', {
      name: 'staging',
      webhook_url: 'https://hooks.slack.com/test',
      branch_pattern: 'main',
    })
    expect(client.post).toHaveBeenCalledWith('/api/v1/projects/proj-1/environments', {
      name: 'staging',
      webhook_url: 'https://hooks.slack.com/test',
      branch_pattern: 'main',
    })
  })

  it('deleteEnvironment calls DELETE', async () => {
    await deployments.deleteEnvironment('env-1')
    expect(client.del).toHaveBeenCalledWith('/api/v1/environments/env-1')
  })

  it('triggerDeploy calls POST with ticketId and environment_id', async () => {
    await deployments.triggerDeploy('t-1', 'env-1')
    expect(client.post).toHaveBeenCalledWith('/api/v1/tickets/t-1/deploy', {
      environment_id: 'env-1',
    })
  })

  it('rollbackDeployment calls POST /:id/rollback', async () => {
    await deployments.rollbackDeployment('deploy-1')
    expect(client.post).toHaveBeenCalledWith('/api/v1/deployments/deploy-1/rollback')
  })

  it('getDeploymentHistory calls GET with query params', async () => {
    await deployments.getDeploymentHistory('t-1', 10, 0)
    expect(client.get).toHaveBeenCalledWith('/api/v1/tickets/t-1/deployments?limit=10&offset=0')
  })

  it('updateDeploymentStatus calls PATCH with status', async () => {
    await deployments.updateDeploymentStatus('deploy-1', 'deployed')
    expect(client.patch).toHaveBeenCalledWith('/api/v1/deployments/deploy-1/status', {
      status: 'deployed',
    })
  })
})
