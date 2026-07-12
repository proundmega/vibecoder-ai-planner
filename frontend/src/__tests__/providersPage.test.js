import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import Providers from '@/views/Providers.vue'

vi.mock('@/api/providers', () => ({
  listProviders: vi.fn(),
  addProvider: vi.fn(),
  updateProvider: vi.fn(),
  deleteProvider: vi.fn(),
  testProvider: vi.fn(),
  setDirector: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}))

describe('Providers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function createWrapper(providers = []) {
    const { listProviders } = await import('@/api/providers')
    listProviders.mockResolvedValue(providers)

    const wrapper = mount(Providers, {
      global: {
        stubs: { 'router-link': { template: '<span><slot /></span>' } },
      },
    })
    // Wait for onMounted to complete and async data to load
    await new Promise(r => setTimeout(r, 100))
    return wrapper
  }

  it('renders page header with title', async () => {
    const wrapper = await createWrapper([{ id: 'p1', name: 'OpenAI', providerType: 'openai' }])
    expect(wrapper.find('h1').text()).toBe('AI Providers')
  })

  it('renders Add Provider button', async () => {
    const wrapper = await createWrapper([{ id: 'p1', name: 'OpenAI', providerType: 'openai' }])
    expect(wrapper.find('button').text()).toContain('Add Provider')
  })

  it('renders provider cards when providers exist', async () => {
    const wrapper = await createWrapper([
      { id: 'p1', name: 'OpenAI', providerType: 'openai', model: 'gpt-4o', is_project_director: true },
      { id: 'p2', name: 'Anthropic', providerType: 'anthropic', model: 'claude-3' },
    ])
    expect(wrapper.findAll('.provider-card').length).toBe(2)
  })

  it('shows director badge on director provider', async () => {
    const wrapper = await createWrapper([
      { id: 'p1', name: 'OpenAI', providerType: 'openai', is_project_director: true },
    ])
    const directorCard = wrapper.find('.provider-card.director')
    expect(directorCard.exists()).toBe(true)
    expect(directorCard.find('.director-badge').text()).toContain('Director')
  })

  it('renders provider type badge', async () => {
    const wrapper = await createWrapper([
      { id: 'p1', name: 'OpenAI', providerType: 'openai' },
    ])
    const typeBadges = wrapper.findAll('.provider-type-badge')
    expect(typeBadges.length).toBeGreaterThan(0)
  })

  it('shows empty state when no providers', async () => {
    const wrapper = await createWrapper([])
    expect(wrapper.find('.empty-state').exists()).toBe(true)
  })

  it('toggles add form on button click', async () => {
    const wrapper = await createWrapper([{ id: 'p1', name: 'OpenAI', providerType: 'openai' }])
    expect(wrapper.find('.add-form').exists()).toBe(false)

    await wrapper.find('button').trigger('click')
    await new Promise(r => setTimeout(r, 50))

    expect(wrapper.find('.add-form').exists()).toBe(true)
  })

  it('shows error when API call fails', async () => {
    const { listProviders } = await import('@/api/providers')
    listProviders.mockRejectedValue(new Error('Network error'))

    const wrapper = mount(Providers, {
      global: {
        stubs: { 'router-link': { template: '<span><slot /></span>' } },
      },
    })
    await new Promise(r => setTimeout(r, 100))

    expect(wrapper.find('.error-message').exists()).toBe(true)
  })
})
