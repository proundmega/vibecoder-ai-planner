import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as harness from '@/api/harnessObservability'
import * as client from '@/api/client'

vi.mock('@/api/client', () => ({
  get: vi.fn(),
  put: vi.fn(),
}))

describe('harness observability API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads the project dashboard', async () => {
    await harness.getHarnessDashboard(7, { since: '2026-11-01', until: '2026-11-07' })
    expect(client.get).toHaveBeenCalledWith(
      '/api/v1/harness/projects/7/dashboard?since=2026-11-01&until=2026-11-07'
    )
  })

  it('omits empty query parameters', async () => {
    await harness.getHarnessAudit(7, { since: '', limit: '50' })
    expect(client.get).toHaveBeenCalledWith(
      '/api/v1/harness/projects/7/audit?limit=50'
    )
  })

  it('loads a replay timeline by run id', async () => {
    await harness.getHarnessTimeline('run-1')
    expect(client.get).toHaveBeenCalledWith('/api/v1/harness/runs/run-1/timeline')
  })

  it('updates the budget policy', async () => {
    await harness.updateHarnessBudgetPolicy(7, { maxCostUsd: 5 })
    expect(client.put).toHaveBeenCalledWith(
      '/api/v1/harness/projects/7/budget-policy',
      { maxCostUsd: 5 }
    )
  })

  it('toggles the project kill switch', async () => {
    await harness.updateHarnessKillSwitch(7, true, 'incident')
    expect(client.put).toHaveBeenCalledWith(
      '/api/v1/harness/projects/7/kill-switch',
      { enabled: true, reason: 'incident' }
    )
  })

  it('reads the project kill switch', async () => {
    await harness.getHarnessKillSwitch(7)
    expect(client.get).toHaveBeenCalledWith(
      '/api/v1/harness/projects/7/kill-switch'
    )
  })

  it('reads the kill-switch audit with a limit', async () => {
    await harness.getHarnessKillSwitchAudit(7, { limit: '25' })
    expect(client.get).toHaveBeenCalledWith(
      '/api/v1/harness/projects/7/kill-switch/audit?limit=25'
    )
  })
})
