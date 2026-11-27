import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as git from '../api/git'

vi.mock('../api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
}))

describe('git API', () => {
  beforeEach(() => vi.clearAllMocks())

  it('normalizes a provider-neutral repo row', async () => {
    const { get } = await import('../api/client')
    get.mockResolvedValue({
      id: 3,
      projectId: 42,
      provider: 'forgejo',
      repoUrl: 'https://git.example.com/group/repo.git',
      defaultBranch: 'main',
      isActive: true,
      providerBaseUrl: 'https://git.example.com',
      authMode: 'pat',
    })

    const result = await git.getRepoStatus('42', 'forgejo')

    expect(get).toHaveBeenCalledWith('/api/v1/git/42/repo?provider=forgejo')
    expect(result).toMatchObject({
      provider: 'forgejo',
      repoUrl: 'https://git.example.com/group/repo.git',
      providerBaseUrl: 'https://git.example.com',
      authMode: 'pat',
      connected: true,
    })
  })

  it('lists every active connection', async () => {
    const { get } = await import('../api/client')
    get.mockResolvedValue([
      { projectId: 1, provider: 'github', repoUrl: 'owner/repo', isActive: true },
      { projectId: 1, provider: 'forgejo', repoUrl: 'group/repo', isActive: true },
    ])

    const rows = await git.listRepos('1')

    expect(get).toHaveBeenCalledWith('/api/v1/git/1/repos')
    expect(rows.map((row) => row.provider)).toEqual(['github', 'forgejo'])
  })

  it('connects with the selected provider fields', async () => {
    const { post } = await import('../api/client')
    post.mockResolvedValue({ provider: 'gitea', repoUrl: 'group/repo', isActive: true })

    await git.connectRepo('1', {
      provider: 'gitea',
      repoUrl: 'group/repo',
      baseUrl: 'https://git.example.com',
      authMode: 'pat',
      token: 'token',
    })

    expect(post).toHaveBeenCalledWith('/api/v1/git/1/repo/connect', {
      provider: 'gitea',
      repoUrl: 'group/repo',
      baseUrl: 'https://git.example.com',
      authMode: 'pat',
      token: 'token',
    })
  })

  it('scopes disconnect, branches and reviews by provider', async () => {
    const { get, del } = await import('../api/client')
    get.mockResolvedValue([])
    del.mockResolvedValue(undefined)

    await git.disconnectRepo('1', 'forgejo')
    await git.listBranches('1', 'forgejo')
    await git.listReviews('1', 'forgejo')

    expect(del).toHaveBeenCalledWith('/api/v1/git/1/repo?provider=forgejo')
    expect(get).toHaveBeenCalledWith('/api/v1/git/1/branches?provider=forgejo')
    expect(get).toHaveBeenCalledWith('/api/v1/git/1/reviews?provider=forgejo')
  })

  it('parses ticket ids from branch names', async () => {
    const { get } = await import('../api/client')
    get.mockResolvedValue(['vibecode/ticket-7-fix', 'main'])

    const branches = await git.listBranches('1')

    expect(branches).toEqual([
      { name: 'vibecode/ticket-7-fix', ticketId: '7' },
      { name: 'main', ticketId: null },
    ])
  })

  it('normalizes reviews that carry no title or head', async () => {
    const { get } = await import('../api/client')
    get.mockResolvedValue([{ number: 3, url: 'https://git.example.com/group/repo/pulls/3', state: 'open' }])

    const reviews = await git.listReviews('1')

    expect(reviews).toEqual([{
      id: undefined,
      number: 3,
      title: undefined,
      state: 'open',
      url: 'https://git.example.com/group/repo/pulls/3',
      head: undefined,
      base: undefined,
    }])
  })

  it('creates a review with the ticket and provider', async () => {
    const { post } = await import('../api/client')
    post.mockResolvedValue({ number: 9, url: 'https://git.example.com/group/repo/pulls/9', state: 'open' })

    const review = await git.createReview('42', 'body', 'forgejo')

    expect(post).toHaveBeenCalledWith('/api/v1/git/42/review', {
      description: 'body',
      provider: 'forgejo',
    })
    expect(review.number).toBe(9)
  })

  it('falls back to an empty provider list when the endpoint fails', async () => {
    const { get } = await import('../api/client')
    get.mockRejectedValue(new Error('nope'))

    expect(await git.listProviders()).toEqual([])
  })
})
