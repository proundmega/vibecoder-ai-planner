import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import Providers from '@/views/Providers.vue'
import * as registryApi from '@/api/providerRegistry'

const { authState } = vi.hoisted(() => ({
  authState: { manage: true },
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    hasAnyPermission: () => authState.manage,
  }),
}))

vi.mock('@/api/providerRegistry', () => ({
  listCredentials: vi.fn(),
  listCredentialModels: vi.fn(),
  createCredential: vi.fn(),
  updateCredential: vi.fn(),
  deleteCredential: vi.fn(),
  discoverModels: vi.fn(),
  addModel: vi.fn(),
  testModel: vi.fn(),
  deleteModel: vi.fn(),
  updateModel: vi.fn(),
}))

const credential = {
  id: 1,
  owner_id: 9,
  project_id: null,
  name: 'Acme production',
  provider_type: 'openai',
  base_url: 'https://api.example.com/v1',
  version: 2,
  status: 'active' as const,
  api_key_masked: 'sk-••••1234',
  created_at: '2026-11-01T10:00:00.000Z',
  updated_at: '2026-11-20T10:00:00.000Z',
  models: [
    {
      id: 10,
      credential_id: 1,
      model: 'gpt-4o',
      display_name: 'GPT-4o',
      source: 'manual' as const,
      status: 'verified' as const,
      roles: ['worker', 'reviewer'] as const,
      max_tokens: 4096,
      context_window: 128000,
      effort: 'high' as const,
      last_verified_at: '2026-11-20T09:00:00.000Z',
      last_verify_error: null,
      created_at: '2026-11-01T10:00:00.000Z',
      updated_at: '2026-11-20T09:00:00.000Z',
    },
    {
      id: 11,
      credential_id: 1,
      model: 'o3-preview',
      display_name: null,
      source: 'discovered' as const,
      status: 'unverified' as const,
      roles: ['reviewer'] as const,
      max_tokens: null,
      context_window: null,
      effort: 'medium' as const,
      last_verified_at: null,
      last_verify_error: 'model not ready',
      created_at: '2026-11-01T10:00:00.000Z',
      updated_at: '2026-11-20T09:00:00.000Z',
    },
    {
      id: 12,
      credential_id: 1,
      model: 'legacy-model',
      display_name: 'Legacy',
      source: 'manual' as const,
      status: 'disabled' as const,
      roles: [] as const,
      max_tokens: 1024,
      context_window: 2048,
      effort: 'low' as const,
      last_verified_at: null,
      last_verify_error: null,
      created_at: '2026-11-01T10:00:00.000Z',
      updated_at: '2026-11-20T09:00:00.000Z',
    },
  ],
}

function getButton(wrapper: VueWrapper, label: string) {
  return wrapper.findAll('button').find(button => button.text() === label)
}

describe('Provider registry view', () => {
  let wrapper: VueWrapper | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    authState.manage = true
    vi.stubGlobal('confirm', vi.fn(() => true))
    ;(registryApi.listCredentials as ReturnType<typeof vi.fn>).mockResolvedValue([credential])
    ;(registryApi.listCredentialModels as ReturnType<typeof vi.fn>).mockResolvedValue(credential.models)
    ;(registryApi.createCredential as ReturnType<typeof vi.fn>).mockResolvedValue(credential)
    ;(registryApi.updateCredential as ReturnType<typeof vi.fn>).mockResolvedValue(credential)
    ;(registryApi.discoverModels as ReturnType<typeof vi.fn>).mockResolvedValue(
      credential.models.slice(0, 2)
    )
    ;(registryApi.addModel as ReturnType<typeof vi.fn>).mockResolvedValue(credential.models[0])
    ;(registryApi.testModel as ReturnType<typeof vi.fn>).mockResolvedValue({
      verified: true,
      latencyMs: 42,
    })
    ;(registryApi.updateModel as ReturnType<typeof vi.fn>).mockResolvedValue(credential.models[0])
    ;(registryApi.deleteModel as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.unstubAllGlobals()
  })

  async function mountView(): Promise<VueWrapper> {
    const mounted = mount(Providers)
    await flushPromises()
    return mounted
  }

  it('renders credentials masked with status, role and effort tags (FR15)', async () => {
    wrapper = await mountView()

    expect(registryApi.listCredentials).toHaveBeenCalled()
    const text = wrapper.text()
    expect(text).toContain('Acme production')
    expect(text).toContain('sk-••••1234')
    expect(text).toContain('verified')
    expect(text).toContain('unverified')
    expect(text).toContain('disabled')
    expect(text).toContain('worker')
    expect(text).toContain('reviewer')
    expect(text).toContain('high')
    expect(text).toContain('medium')
    expect(text).toContain('low')
    expect(text).toContain('manual')
    expect(text).toContain('discovered')
    expect(wrapper.find('.model-status-verified').exists()).toBe(true)
    expect(wrapper.find('.model-status-unverified').exists()).toBe(true)
    expect(wrapper.find('.model-status-disabled').exists()).toBe(true)
    expect(wrapper.find('.verify-error').text()).toContain('model not ready')
  })

  it('adds a credential with project scope', async () => {
    wrapper = await mountView()

    const add = getButton(wrapper, 'Add credential')
    expect(add).toBeTruthy()
    await add!.trigger('click')
    await flushPromises()

    await wrapper.find('#credential-name').setValue('Acme staging')
    await wrapper.find('#credential-type').setValue('anthropic')
    await wrapper.find('#credential-key').setValue('sk-new-secret')
    await wrapper.find('#credential-base-url').setValue('https://staging.example.com/v1')
    await wrapper.find('#credential-project').setValue('5')

    const submit = wrapper.find('.add-form').findAll('button')
      .find(button => button.text() === 'Add credential')
    expect(submit).toBeTruthy()
    await submit!.trigger('click')
    await flushPromises()

    expect(registryApi.createCredential).toHaveBeenCalledWith({
      name: 'Acme staging',
      providerType: 'anthropic',
      apiKey: 'sk-new-secret',
      baseUrl: 'https://staging.example.com/v1',
      projectId: '5',
    })
  })

  it('discovers models and refreshes the list', async () => {
    wrapper = await mountView()

    const discover = getButton(wrapper, 'Discover')
    expect(discover).toBeTruthy()
    await discover!.trigger('click')
    await flushPromises()

    expect(registryApi.discoverModels).toHaveBeenCalledWith(1)
    expect(wrapper.text()).toContain('2 models found')
    expect(registryApi.listCredentials).toHaveBeenCalledTimes(2)
  })

  it('adds a model manually with roles, effort and token metadata', async () => {
    wrapper = await mountView()

    const openForm = wrapper.find('.card-actions').findAll('button')
      .find(button => button.text() === 'Add model')
    expect(openForm).toBeTruthy()
    await openForm!.trigger('click')
    await flushPromises()

    await wrapper.find('#new-model-id-1').setValue('gpt-5')
    await wrapper.find('#new-model-name-1').setValue('GPT-5')
    await wrapper.find('#new-model-effort-1').setValue('high')
    await wrapper.find('#new-model-max-1').setValue('8192')
    await wrapper.find('#new-model-context-1').setValue('200000')
    await wrapper.find('.model-form input[value="planner"]').setValue(true)

    const submit = wrapper.find('.model-form').findAll('button')
      .find(button => button.text() === 'Add model')
    expect(submit).toBeTruthy()
    await submit!.trigger('click')
    await flushPromises()

    expect(registryApi.addModel).toHaveBeenCalledWith(1, {
      model: 'gpt-5',
      displayName: 'GPT-5',
      roles: ['planner'],
      effort: 'high',
      maxTokens: 8192,
      contextWindow: 200000,
    })
  })

  it('tests a model and shows verified latency', async () => {
    wrapper = await mountView()

    const firstRow = wrapper.findAll('.model-table tbody tr')[0]
    const test = firstRow.findAll('button').find(button => button.text() === 'Test')
    expect(test).toBeTruthy()
    await test!.trigger('click')
    await flushPromises()

    expect(registryApi.testModel).toHaveBeenCalledWith(10)
    expect(wrapper.text()).toContain('Verified in 42 ms')
  })

  it('deletes a model through the model endpoint', async () => {
    wrapper = await mountView()

    const firstRow = wrapper.findAll('.model-table tbody tr')[0]
    const remove = firstRow.findAll('button').find(button => button.text() === 'Delete')
    expect(remove).toBeTruthy()
    await remove!.trigger('click')
    await flushPromises()

    expect(registryApi.deleteModel).toHaveBeenCalledWith(10)
  })

  it('shows a stored verification error when a test fails', async () => {
    ;(registryApi.testModel as ReturnType<typeof vi.fn>).mockResolvedValue({
      verified: false,
      latencyMs: 12,
      error: 'invalid model',
    })

    wrapper = await mountView()

    const secondRow = wrapper.findAll('.model-table tbody tr')[1]
    const test = secondRow.findAll('button').find(button => button.text() === 'Test')
    await test!.trigger('click')
    await flushPromises()

    expect(registryApi.testModel).toHaveBeenCalledWith(11)
    expect(wrapper.text()).toContain('invalid model')
  })

  it('keeps the row when delete returns 409 with references', async () => {
    const inUse = Object.assign(new Error('Credential is still referenced'), {
      status: 409,
      referencingRuntimes: [{ id: 1, name: 'worker-1' }],
      referencingModels: [{ id: 10, model: 'gpt-4o' }],
    })
    ;(registryApi.deleteCredential as ReturnType<typeof vi.fn>).mockRejectedValue(inUse)

    wrapper = await mountView()

    const remove = getButton(wrapper, 'Delete')
    expect(remove).toBeTruthy()
    await remove!.trigger('click')
    await flushPromises()

    expect(registryApi.deleteCredential).toHaveBeenCalledWith(1)
    const conflict = wrapper.find('.delete-conflict')
    expect(conflict.exists()).toBe(true)
    expect(conflict.text()).toContain('Credential is still referenced')
    expect(conflict.text()).toContain('worker-1')
    expect(conflict.text()).toContain('gpt-4o')
    expect(wrapper.text()).toContain('Acme production')
    expect(registryApi.listCredentials).toHaveBeenCalledTimes(1)
  })

  it('disables and re-enables a model', async () => {
    wrapper = await mountView()

    const verifiedRow = wrapper.findAll('.model-table tbody tr')[0]
    const disable = verifiedRow.findAll('button').find(button => button.text() === 'Disable')
    expect(disable).toBeTruthy()
    await disable!.trigger('click')
    await flushPromises()
    expect(registryApi.updateModel).toHaveBeenCalledWith(10, { status: 'disabled' })

    const disabledRow = wrapper.findAll('.model-table tbody tr')[2]
    const enable = disabledRow.findAll('button').find(button => button.text() === 'Enable')
    expect(enable).toBeTruthy()
    await enable!.trigger('click')
    await flushPromises()
    expect(registryApi.updateModel).toHaveBeenCalledWith(12, { status: 'unverified' })
  })

  it('edits roles, effort and max tokens on a model', async () => {
    wrapper = await mountView()

    const firstRow = wrapper.findAll('.model-table tbody tr')[0]
    const edit = firstRow.findAll('button').find(button => button.text() === 'Edit')
    expect(edit).toBeTruthy()
    await edit!.trigger('click')
    await flushPromises()

    expect(wrapper.find('.model-edit-form').exists()).toBe(true)
    await wrapper.find('#edit-model-effort-10').setValue('max')
    await wrapper.find('#edit-model-max-10').setValue('2048')
    await wrapper.find('.model-edit-form input[value="planner"]').setValue(true)

    const save = wrapper.find('.model-edit-form').findAll('button')
      .find(button => button.text() === 'Save model')
    expect(save).toBeTruthy()
    await save!.trigger('click')
    await flushPromises()

    const call = (registryApi.updateModel as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe(10)
    expect(call[1]).toEqual(expect.objectContaining({ effort: 'max', maxTokens: 2048 }))
    expect(call[1].roles).toEqual(expect.arrayContaining(['worker', 'reviewer', 'planner']))
  })

  it('rotates a credential key through PATCH', async () => {
    wrapper = await mountView()

    const edit = wrapper.find('.card-actions').findAll('button')
      .find(button => button.text() === 'Edit')
    expect(edit).toBeTruthy()
    await edit!.trigger('click')
    await flushPromises()

    await wrapper.find('#edit-credential-key-1').setValue('sk-rotated')
    const save = wrapper.find('.edit-form').findAll('button')
      .find(button => button.text() === 'Save credential')
    await save!.trigger('click')
    await flushPromises()

    expect(registryApi.updateCredential).toHaveBeenCalledWith(1, {
      baseUrl: 'https://api.example.com/v1',
      status: 'active',
      apiKey: 'sk-rotated',
    })
  })

  it('hides management controls without PROJECT_MANAGE_MEMBERS', async () => {
    authState.manage = false
    wrapper = await mountView()

    expect(wrapper.text()).toContain('Acme production')
    const labels = wrapper.findAll('button').map(button => button.text())
    expect(labels).not.toContain('Add credential')
    expect(labels).not.toContain('Discover')
    expect(labels).not.toContain('Delete')
    expect(labels).not.toContain('Test')
  })
})
