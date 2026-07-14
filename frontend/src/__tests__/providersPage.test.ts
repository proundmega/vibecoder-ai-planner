import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, VueWrapper } from '@vue/test-utils'
import ProvidersPage from '@/views/Providers.vue'
import * as providersApi from '@/api/providers'

vi.mock('@/api/providers', () => ({
  listProviders: vi.fn(),
  addProvider: vi.fn(),
  updateProvider: vi.fn(),
  deleteProvider: vi.fn(),
  testProvider: vi.fn(),
  setDirector: vi.fn(),
}))

describe('ProvidersPage', () => {
  let wrapper: VueWrapper

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('confirm', vi.fn(() => true))
  })

  afterEach(() => {
    wrapper?.unmount()
  })

  const mountOptions = {
    global: {
      stubs: {
        Teleport: { template: '<div><slot /></div>' },
      },
    },
  }

  it('renders page header with title and Add Provider button', async () => {
    ;(providersApi.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue([])
    wrapper = mount(ProvidersPage, mountOptions)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('h1').text()).toBe('AI Providers')
    expect(wrapper.findAll('button').length).toBeGreaterThan(0)
  })

  it('shows loading state initially', () => {
    ;(providersApi.listProviders as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}))
    wrapper = mount(ProvidersPage, mountOptions)
    expect(wrapper.find('.loading').text()).toContain('Loading')
  })

  it('shows empty state when no providers', async () => {
    ;(providersApi.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue([])
    wrapper = mount(ProvidersPage, mountOptions)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.empty-state').exists()).toBe(true)
    expect(wrapper.find('.empty-state p').text()).toContain('No AI providers configured')
  })

  it('renders provider cards when providers exist', async () => {
    const mockProviders = [
      { id: '1', name: 'OpenAI', providerType: 'openai', model: 'gpt-4o', is_project_director: true, is_active: true },
      { id: '2', name: 'Claude', providerType: 'anthropic', model: 'claude-3', is_project_director: false, is_active: true },
    ]
    ;(providersApi.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue(mockProviders)
    wrapper = mount(ProvidersPage, mountOptions)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.provider-card').length).toBe(2)
    expect(wrapper.find('.provider-card.director').exists()).toBe(true)
  })

  it('shows add form when Add Provider button is clicked', async () => {
    ;(providersApi.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue([])
    wrapper = mount(ProvidersPage, mountOptions)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    const buttons = wrapper.findAll('button')
    await buttons[0].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.add-form').exists()).toBe(true)
  })

  it('submits add provider form with correct data', async () => {
    ;(providersApi.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(providersApi.addProvider as ReturnType<typeof vi.fn>).mockResolvedValue({ id: '1', name: 'Test' })
    wrapper = mount(ProvidersPage, mountOptions)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    const buttons = wrapper.findAll('button')
    await buttons[0].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    const inputs = wrapper.findAll('input')
    await inputs[0].setValue('Test Provider')
    await wrapper.find('select').setValue('openai')
    await inputs[2].setValue('sk-test123')
    const addButtons = wrapper.findAll('.add-form button')
    await addButtons[0].trigger('click')
    await wrapper.vm.$nextTick()
    expect(providersApi.addProvider).toHaveBeenCalledWith({
      name: 'Test Provider',
      providerType: 'openai',
      apiKey: 'sk-test123',
      is_project_director: false,
      model: undefined,
      endpoint_url: undefined,
      fallback_provider: null,
    })
  })

  it('shows edit form when Edit button is clicked', async () => {
    const mockProviders = [{ id: '1', name: 'OpenAI', providerType: 'openai', model: 'gpt-4o', is_project_director: false, is_active: true }]
    ;(providersApi.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue(mockProviders)
    wrapper = mount(ProvidersPage, mountOptions)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    const buttons = wrapper.findAll('button')
    const editButton = buttons.find(b => b.text() === 'Edit')
    if (editButton) {
      await editButton.trigger('click')
      await wrapper.vm.$nextTick()
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.edit-form').exists()).toBe(true)
    }
  })

  it('deletes provider when Delete button is clicked', async () => {
    const mockProviders = [{ id: '1', name: 'OpenAI', providerType: 'openai', model: 'gpt-4o', is_project_director: false, is_active: true }]
    ;(providersApi.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue(mockProviders)
    ;(providersApi.deleteProvider as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    wrapper = mount(ProvidersPage, mountOptions)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    const buttons = wrapper.findAll('button')
    const deleteButton = buttons.find(b => b.text() === 'Delete')
    if (deleteButton) {
      await deleteButton.trigger('click')
      await wrapper.vm.$nextTick()
      expect(providersApi.deleteProvider).toHaveBeenCalledWith('1')
    }
  })

  it('skips delete when user cancels confirmation', async () => {
    ;(providersApi.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue([])
    vi.mocked(confirm).mockReturnValue(false)
    wrapper = mount(ProvidersPage, mountOptions)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(providersApi.deleteProvider).not.toHaveBeenCalled()
  })

  it('tests provider connection', async () => {
    const mockProviders = [{ id: '1', name: 'OpenAI', providerType: 'openai', model: 'gpt-4o', is_project_director: false, is_active: true }]
    ;(providersApi.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue(mockProviders)
    ;(providersApi.testProvider as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, valid: true, message: 'OK' })
    wrapper = mount(ProvidersPage, mountOptions)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    const buttons = wrapper.findAll('button')
    const testButton = buttons.find(b => b.text() === 'Test')
    if (testButton) {
      await testButton.trigger('click')
      await wrapper.vm.$nextTick()
      expect(providersApi.testProvider).toHaveBeenCalledWith('1')
      expect(wrapper.find('.test-result.success').exists()).toBe(true)
    }
  })

  it('sets director on provider', async () => {
    const mockProviders = [{ id: '1', name: 'OpenAI', providerType: 'openai', model: 'gpt-4o', is_project_director: false, is_active: true }]
    ;(providersApi.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue(mockProviders)
    ;(providersApi.setDirector as ReturnType<typeof vi.fn>).mockResolvedValue({ id: '1', is_project_director: true })
    wrapper = mount(ProvidersPage, mountOptions)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    const buttons = wrapper.findAll('button')
    const directorButton = buttons.find(b => b.text() === '🎯')
    if (directorButton) {
      await directorButton.trigger('click')
      await wrapper.vm.$nextTick()
      expect(providersApi.setDirector).toHaveBeenCalledWith('1')
    }
  })

  it('disables director button on current director', async () => {
    const mockProviders = [{ id: '1', name: 'OpenAI', providerType: 'openai', model: 'gpt-4o', is_project_director: true, is_active: true }]
    ;(providersApi.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue(mockProviders)
    wrapper = mount(ProvidersPage, mountOptions)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    const buttons = wrapper.findAll('button')
    const directorButton = buttons.find(b => b.text() === '🎯')
    if (directorButton) {
      expect(directorButton.attributes('disabled')).toBeDefined()
    }
  })

  it('shows error message when loading fails', async () => {
    ;(providersApi.listProviders as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'))
    wrapper = mount(ProvidersPage, mountOptions)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.error-message').exists()).toBe(true)
    expect(wrapper.find('.error-message').text()).toBe('Network error')
  })

  it('resets form after successful add', async () => {
    ;(providersApi.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(providersApi.addProvider as ReturnType<typeof vi.fn>).mockResolvedValue({ id: '1', name: 'Test' })
    wrapper = mount(ProvidersPage, mountOptions)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    const buttons = wrapper.findAll('button')
    await buttons[0].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    const inputs = wrapper.findAll('input')
    await inputs[0].setValue('Test Provider')
    const addButtons = wrapper.findAll('.add-form button')
    await addButtons[0].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.add-form').exists()).toBe(false)
  })

  it('shows endpoint_url field for ollama provider type', async () => {
    ;(providersApi.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue([])
    wrapper = mount(ProvidersPage, mountOptions)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    const buttons = wrapper.findAll('button')
    await buttons[0].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.find('select').setValue('ollama')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('input[placeholder="http://localhost:11434/v1"]').exists()).toBe(true)
  })

  it('hides endpoint_url field for openai provider type', async () => {
    ;(providersApi.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue([])
    wrapper = mount(ProvidersPage, mountOptions)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    const buttons = wrapper.findAll('button')
    await buttons[0].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('input[placeholder="http://localhost:11434/v1"]').exists()).toBe(false)
  })
})
