import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import RepoProfileEditor from '../components/RepoProfileEditor.vue'

const { row, activeRow, oldDraft, authState } = vi.hoisted(() => {
  const profile = {
    schema_version: 1,
    repo_url: 'https://github.com/acme/app',
    base_branch: 'main',
    languages: ['node'],
    setup: ['npm ci'],
    verify: ['npm test'],
    caches: [],
    env: { NODE_ENV: 'test' },
    timeouts: { setup_minutes: 15, verify_minutes: 20 },
    max_round_minutes: 45,
    services: [],
    flaky_tests: [],
  }
  const row = {
    id: 'p1',
    project_id: '1',
    version: 1,
    profile,
    profile_hash: 'h1',
    status: 'draft',
    created_at: '2026-11-17T00:00:00Z',
  }
  const activeRow = {
    ...row,
    id: 'p0',
    version: 0,
    status: 'active',
    profile_hash: 'h0',
  }
  const oldDraft = {
    ...row,
    id: 'p-old',
    version: 0,
    profile_hash: 'h-old',
  }
  const authState = {
    user: { value: { id: '7' } },
    superAdmin: true,
  }
  return { profile, row, activeRow, oldDraft, authState }
})

vi.mock('../api/projects', () => ({
  fetchProjectById: vi.fn().mockResolvedValue({ id: '1', ownerId: '7' }),
}))

vi.mock('../api/repoProfiles', () => ({
  getRepoProfile: vi.fn().mockResolvedValue({
    active: activeRow, latest: row, versions: [row, oldDraft, activeRow],
  }),
  listProfileValidations: vi.fn().mockResolvedValue([]),
  getProfileValidation: vi.fn(),
  createRepoProfile: vi.fn().mockResolvedValue(row),
  updateRepoProfile: vi.fn().mockResolvedValue(row),
  detectRepoProfile: vi.fn(),
  activateRepoProfile: vi.fn().mockResolvedValue({ ...row, status: 'active' }),
  requestProfileValidation: vi.fn(),
}))

vi.mock('../stores/auth', () => ({
  useAuthStore: () => ({
    user: authState.user,
    isSuperAdmin: () => authState.superAdmin,
  }),
}))

import { fetchProjectById } from '../api/projects'
import {
  activateRepoProfile,
  createRepoProfile,
  detectRepoProfile,
  getRepoProfile,
  getProfileValidation,
  listProfileValidations,
  requestProfileValidation,
  updateRepoProfile,
} from '../api/repoProfiles'

function button(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper.findAll('button').find((item) => item.text() === label)
}

describe('RepoProfileEditor', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(fetchProjectById).mockResolvedValue({ id: '1', ownerId: '7' } as never)
    vi.mocked(getRepoProfile).mockResolvedValue({
      active: activeRow, latest: row, versions: [row, oldDraft, activeRow],
    } as never)
    vi.mocked(listProfileValidations).mockResolvedValue([])
    vi.mocked(createRepoProfile).mockResolvedValue(row as never)
    vi.mocked(updateRepoProfile).mockResolvedValue(row as never)
    vi.mocked(activateRepoProfile).mockResolvedValue({ ...row, status: 'active' } as never)
    authState.user = { value: { id: '7' } }
    authState.superAdmin = true
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows a historical active version as read-only', async () => {
    const wrapper = mount(RepoProfileEditor, {
      props: { projectId: '1' },
    })
    await flushPromises()

    const viewButtons = wrapper.findAll('button').filter(
      (item) => item.text() === 'View',
    )
    expect(viewButtons.length).toBe(3)
    await viewButtons[2].trigger('click')

    expect(wrapper.text()).toContain('read-only')
    expect(wrapper.text()).toContain('Back to editor')
    expect(button(wrapper, 'Save draft')?.attributes('disabled')).toBeDefined()
    expect(button(wrapper, 'Validate (dry run)')?.attributes('disabled')).toBeDefined()
    expect(button(wrapper, 'Activate')?.attributes('disabled')).toBeDefined()

    await button(wrapper, 'Back to editor')!.trigger('click')
    expect(wrapper.text()).not.toContain('Viewing version')
  })

  it('does not edit an older draft in place', async () => {
    const wrapper = mount(RepoProfileEditor, {
      props: { projectId: '1' },
    })
    await flushPromises()

    const viewButtons = wrapper.findAll('button').filter(
      (item) => item.text() === 'View',
    )
    await viewButtons[1].trigger('click')

    expect(wrapper.text()).toContain('read-only')
    expect(button(wrapper, 'Save draft')?.attributes('disabled')).toBeDefined()
  })


  it('confirms detection when only non-service fields were edited', async () => {
    vi.mocked(getRepoProfile).mockResolvedValueOnce({
      active: null, latest: null, versions: [],
    } as never)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

    const wrapper = mount(RepoProfileEditor, {
      props: { projectId: '1' },
    })
    await flushPromises()
    await wrapper.find('input[placeholder="main"]').setValue('release')
    await button(wrapper, 'Detect from repo')!.trigger('click')
    await flushPromises()

    expect(confirm).toHaveBeenCalled()
    expect(detectRepoProfile).not.toHaveBeenCalled()
  })

  it('loads a draft and saves the edited profile', async () => {
    const wrapper = mount(RepoProfileEditor, {
      props: { projectId: '1' },
    })
    await flushPromises()

    expect(getRepoProfile).toHaveBeenCalledWith('1')
    expect(wrapper.text()).toContain('Repository Profile')
    const textareas = wrapper.findAll('textarea')
    expect(textareas[0].element.value).toContain('npm ci')
    expect(textareas[1].element.value).toContain('npm test')

    const save = button(wrapper, 'Save draft')
    expect(save).toBeTruthy()
    await save!.trigger('click')
    await flushPromises()

    expect(updateRepoProfile).toHaveBeenCalledWith(
      '1',
      'p1',
      expect.objectContaining({
        verify: ['npm test'],
        setup: ['npm ci'],
        env: { NODE_ENV: 'test' },
      }),
    )
  })

  it('round-trips service rows through save', async () => {
    const serviceProfile = {
      ...row.profile,
      services: [{
        name: 'postgres',
        image: `postgres@sha256:${'a'.repeat(64)}`,
        env: { POSTGRES_USER: 'vibecode' },
        password_env: 'POSTGRES_PASSWORD',
        connection_env: 'DATABASE_URL',
        connection_url: 'postgresql://vibecode:${password}@${host}:5432/test',
        healthcheck: {
          command: 'pg_isready', interval_seconds: 2, timeout_seconds: 5,
          retries: 30, start_period_seconds: 3,
        },
      }],
    }
    const serviceRow = { ...row, profile: serviceProfile }
    vi.mocked(getRepoProfile).mockResolvedValueOnce({
      active: null, latest: serviceRow, versions: [serviceRow],
    } as never)

    const wrapper = mount(RepoProfileEditor, {
      props: { projectId: '1' },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Services')
    const nameInput = wrapper.find('input[placeholder="postgres"]')
    expect(nameInput.exists()).toBe(true)
    await nameInput.setValue('postgres2')
    await button(wrapper, 'Save draft')!.trigger('click')
    await flushPromises()

    expect(updateRepoProfile).toHaveBeenCalledWith(
      '1',
      'p1',
      expect.objectContaining({
        services: [expect.objectContaining({
          name: 'postgres2',
          password_env: 'POSTGRES_PASSWORD',
          healthcheck: expect.objectContaining({ start_period_seconds: 3 }),
        })],
      }),
    )
  })

  it('enables detection over an active profile and saves a draft', async () => {
    vi.mocked(getRepoProfile).mockResolvedValueOnce({
      active: activeRow, latest: activeRow, versions: [activeRow],
    } as never)
    vi.mocked(detectRepoProfile).mockResolvedValueOnce({
      detected: true,
      profile: { ...row.profile, verify: ['npm run verify'] },
      warnings: [],
    } as never)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    const wrapper = mount(RepoProfileEditor, {
      props: { projectId: '1' },
    })
    await flushPromises()
    await button(wrapper, 'Detect from repo')!.trigger('click')
    await flushPromises()

    expect(confirm).toHaveBeenCalled()
    expect(wrapper.findAll('textarea')[1].element.value).toContain('npm run verify')
    const save = button(wrapper, 'Create draft')
    expect(save).toBeTruthy()
    expect(save?.attributes('disabled')).toBeUndefined()
    await save!.trigger('click')
    await flushPromises()
    expect(createRepoProfile).toHaveBeenCalledWith(
      '1', expect.objectContaining({ verify: ['npm run verify'] }),
    )
  })

  it('shows the read-only state to a non-owner', async () => {
    authState.user = { value: { id: '99' } }
    authState.superAdmin = false

    const wrapper = mount(RepoProfileEditor, {
      props: { projectId: '1' },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Read-only')
    expect(button(wrapper, 'Save draft')).toBeUndefined()
    expect(button(wrapper, 'Validate (dry run)')).toBeUndefined()
  })

  it('activates only the current draft with a matching successful dry run', async () => {
    const validation = {
      id: 'v1',
      project_id: '1',
      profile_id: 'p1',
      profile_version: 1,
      profile: row.profile,
      profile_hash: 'h1',
      status: 'succeeded',
      result: { commands: [] },
    }
    vi.mocked(listProfileValidations).mockResolvedValueOnce([validation] as never)

    const wrapper = mount(RepoProfileEditor, {
      props: { projectId: '1' },
    })
    await flushPromises()

    const activate = button(wrapper, 'Activate')
    expect(activate?.attributes('disabled')).toBeUndefined()
    await activate!.trigger('click')
    await flushPromises()

    expect(activateRepoProfile).toHaveBeenCalledWith('1', 'p1')
  })

  it('polls a queued dry run and reports success', async () => {
    vi.useFakeTimers()
    vi.mocked(requestProfileValidation).mockResolvedValueOnce({
      id: 'v2', project_id: '1', profile_id: 'p1', profile_version: 1,
      profile: row.profile, profile_hash: 'h1', status: 'queued',
    } as never)
    vi.mocked(getProfileValidation).mockResolvedValueOnce({
      id: 'v2', project_id: '1', profile_id: 'p1', profile_version: 1,
      profile: row.profile, profile_hash: 'h1', status: 'succeeded',
      result: { commands: [] },
    } as never)

    const wrapper = mount(RepoProfileEditor, {
      props: { projectId: '1' },
    })
    await flushPromises()
    await button(wrapper, 'Validate (dry run)')!.trigger('click')
    expect(requestProfileValidation).toHaveBeenCalledWith('1', 'p1')

    await vi.advanceTimersByTimeAsync(1600)
    await flushPromises()

    expect(wrapper.text()).toContain('Dry run succeeded')
  })
})
