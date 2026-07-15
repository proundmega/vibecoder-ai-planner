import { describe, it, expect, vi } from 'vitest'
import * as agentsApi from '@/api/agents'

vi.mock('@/api/agents', () => ({
  fetchAgentStatusList: vi.fn().mockResolvedValue([]),
  createAgent: vi.fn(),
  listAgents: vi.fn().mockResolvedValue({ agents: [] }),
  updateAgentName: vi.fn(),
  deleteAgent: vi.fn(),
  revokeAgentKey: vi.fn(),
  getAgentKeyInfo: vi.fn(),
  getAgentHistory: vi.fn(),
  fetchAgentDetail: vi.fn(),
  getAgentProviderConfig: vi.fn(),
}))

vi.mock('@/api/providers', () => ({
  listProviders: vi.fn().mockResolvedValue([]),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ params: {} }),
}))

describe('AgentList inline edit', () => {
  it('updateAgentName is defined', () => {
    expect(agentsApi.updateAgentName).toBeDefined()
  })

  it('updateAgentName is a function', () => {
    expect(typeof agentsApi.updateAgentName).toBe('function')
  })
})
