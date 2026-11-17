import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import RepoProfileEditor from '../components/RepoProfileEditor.vue'

const { row, activeRow } = vi.hoisted(() => {
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
  return { profile, row, activeRow }
})

vi.mock('../api/projects', () => ({
  fetchProjectById: vi.fn().mockResolvedValue({ id: '1', ownerId: '7' }),
}))

vi.mock('../api/repoProfiles', () => ({
  getRepoProfile: vi.fn().mockResolvedValue({
    active: activeRow, latest: row, versions: [row, activeRow],
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
    user: { id: '7' },
    isSuperAdmin: () => true,
  }),
}))

import {
  getRepoProfile,
  updateRepoProfile,
} from '../api/repoProfiles'

describe('RepoProfileEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a historical version as read-only', async () => {
    const wrapper = mount(RepoProfileEditor, {
      props: { projectId: '1' },
    })
    await flushPromises()

    const viewButtons = wrapper.findAll('button').filter(
      (button) => button.text() === 'View',
    )
    expect(viewButtons.length).toBe(2)
    await viewButtons[1].trigger('click')

    expect(wrapper.text()).toContain('read-only')
    expect(wrapper.text()).toContain('Back to editor')
    const save = wrapper.findAll('button').find(
      (button) => button.text() === 'Save draft',
    )
    expect(save?.attributes('disabled')).toBeDefined()

    const back = wrapper.findAll('button').find(
      (button) => button.text() === 'Back to editor',
    )
    await back!.trigger('click')
    expect(wrapper.text()).not.toContain('Viewing version')
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

    const save = wrapper.findAll('button').find((button) => button.text() === 'Save draft')
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

})
