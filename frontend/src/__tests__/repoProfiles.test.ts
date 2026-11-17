import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}))

import { get, post, put } from '../api/client'
import {
  activateRepoProfile,
  createRepoProfile,
  detectRepoProfile,
  getProfileValidation,
  getRepoProfile,
  listProfileValidations,
  requestProfileValidation,
  updateRepoProfile,
} from '../api/repoProfiles'

describe('repo profile API client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads the current profile and validations', async () => {
    await getRepoProfile('1')
    expect(get).toHaveBeenCalledWith('/api/v1/projects/1/repo-profile')

    await listProfileValidations('1')
    expect(get).toHaveBeenCalledWith('/api/v1/projects/1/repo-profile/validations')

    await getProfileValidation('1', 'v1')
    expect(get).toHaveBeenCalledWith('/api/v1/projects/1/repo-profile/validations/v1')
  })

  it('creates, updates and activates versioned profiles', async () => {
    const profile = { verify: ['npm test'] }
    await createRepoProfile('1', profile as never)
    expect(post).toHaveBeenCalledWith('/api/v1/projects/1/repo-profile', profile)

    await updateRepoProfile('1', 'p1', profile as never)
    expect(put).toHaveBeenCalledWith('/api/v1/projects/1/repo-profile/p1', profile)

    await activateRepoProfile('1', 'p1')
    expect(post).toHaveBeenCalledWith(
      '/api/v1/projects/1/repo-profile/p1/activate',
      {},
    )
  })

  it('detects and validates profiles', async () => {
    await detectRepoProfile('1')
    expect(post).toHaveBeenCalledWith('/api/v1/projects/1/repo-profile/detect', {})

    await requestProfileValidation('1', 'p1')
    expect(post).toHaveBeenCalledWith(
      '/api/v1/projects/1/repo-profile/p1/validate',
      {},
    )
  })
})
