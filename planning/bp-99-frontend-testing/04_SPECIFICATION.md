# 04_SPECIFICATION.md — Frontend Testing Strategy

**Status**: pending
**Date started**: 2026-07-17

---

## Test-First Requirement

For each file created, create the test file FIRST, then the production file. This prevents skipping tests.

## File Operations

### Phase 1: diff.ts Tests

**Operation 1**: Create `frontend/src/__tests__/diff.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { countLines, computePatch } from '@/utils/diff'

describe('countLines', () => {
  it('returns 0 for null', () => {
    expect(countLines(null as any)).toBe(0)
  })

  it('returns 0 for undefined', () => {
    expect(countLines(undefined as any)).toBe(0)
  })

  it('returns 0 for empty string', () => {
    expect(countLines('')).toBe(0)
  })

  it('returns correct count for multi-line strings', () => {
    expect(countLines('a\nb\nc')).toBe(3)
    expect(countLines('a\nb\nc\n')).toBe(3)
  })
})

describe('computePatch', () => {
  it('generates new-file patch when oldContent is null', () => {
    const patch = computePatch(null, 'hello\nworld', 'new.txt')
    expect(patch).toContain('--- /dev/null')
    expect(patch).toContain('+++ /dev/null')
    expect(patch).toContain('@@ -0,0 +1,2 @@')
    expect(patch).toContain('+hello')
    expect(patch).toContain('+world')
  })

  it('generates delete patch when newContent is null', () => {
    const patch = computePatch('hello\nworld', null, 'deleted.txt')
    expect(patch).toContain('--- a/deleted.txt')
    expect(patch).toContain('+++ /dev/null')
    expect(patch).toContain('@@ -1,2 +0,0 @@')
    expect(patch).toContain('-hello')
    expect(patch).toContain('-world')
  })

  it('generates unified diff for modified content', () => {
    const patch = computePatch('a\nb\nc', 'a\nX\nc', 'mod.txt')
    expect(patch).toContain('@@ -1,3 +1,3 @@')
    expect(patch).toContain('-b')
    expect(patch).toContain('+X')
  })

  it('returns empty string for identical content', () => {
    const patch = computePatch('same', 'same', 'same.txt')
    expect(patch).toBe('')
  })

  it('handles empty strings', () => {
    const patch = computePatch('', '', 'empty.txt')
    expect(patch).toBe('')
  })
})
```

### Phase 2: API Client Contract Tests

**Operation 2**: Create `frontend/src/__tests__/api-computeNodes.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as computeNodes from '@/api/computeNodes'

vi.mock('@/api/client', () => ({
  get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn()
}))

const { get, post, put, del } = await vi.importActual('@/api/client')

describe('computeNodes API', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('listComputeNodes calls GET /api/v1/compute-nodes', async () => {
    await computeNodes.listComputeNodes()
    expect(get).toHaveBeenCalledWith('/api/v1/compute-nodes')
  })

  it('createComputeNode calls POST with correct body', async () => {
    await computeNodes.createComputeNode({ name: 'test', sshHost: '1.2.3.4' })
    expect(post).toHaveBeenCalledWith('/api/v1/compute-nodes', {
      name: 'test', sshHost: '1.2.3.4'
    })
  })

  it('updateComputeNode calls PUT with id in path', async () => {
    await computeNodes.updateComputeNode('node-1', { name: 'updated' })
    expect(put).toHaveBeenCalledWith('/api/v1/compute-nodes/node-1', { name: 'updated' })
  })

  it('deleteComputeNode calls DELETE', async () => {
    await computeNodes.deleteComputeNode('node-1')
    expect(del).toHaveBeenCalledWith('/api/v1/compute-nodes/node-1')
  })

  it('testComputeNodeConnection calls POST /:id/test', async () => {
    await computeNodes.testComputeNodeConnection('node-1')
    expect(post).toHaveBeenCalledWith('/api/v1/compute-nodes/node-1/test')
  })

  it('getRunningContainers returns empty array (stub)', async () => {
    const result = await computeNodes.getRunningContainers('node-1')
    expect(result).toEqual([])
  })
})
```

**Operation 3**: Create `frontend/src/__tests__/api-credentials.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as credentials from '@/api/credentials'

vi.mock('@/api/client', () => ({
  get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn()
}))

const { get: getClient, post, patch, del } = await vi.importActual('@/api/client')

describe('credentials API', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('getActiveCredentials returns data on success', async () => {
    ;(getClient as any).mockResolvedValue({ data: [{ id: '1', name: 'key' }] })
    const result = await credentials.getActiveCredentials('proj-1')
    expect(getClient).toHaveBeenCalledWith('/api/v1/projects/proj-1/credentials')
    expect(result).toEqual([{ id: '1', name: 'key' }])
  })

  it('getActiveCredentials returns empty array on failure (silent fallback)', async () => {
    ;(getClient as any).mockRejectedValue(new Error('fail'))
    const result = await credentials.getActiveCredentials('proj-1')
    expect(result).toEqual([])
  })

  it('addCredential calls POST with name/type/key', async () => {
    await credentials.addCredential('proj-1', { name: 'test', type: 'api_key', key: 'secret' })
    expect(post).toHaveBeenCalledWith('/api/v1/projects/proj-1/credentials', {
      name: 'test', type: 'api_key', key: 'secret'
    })
  })

  it('updateCredential calls PATCH with partial data', async () => {
    await credentials.updateCredential('proj-1', 'cred-1', { name: 'updated' })
    expect(patch).toHaveBeenCalledWith('/api/v1/projects/proj-1/credentials/cred-1', {
      name: 'updated'
    })
  })

  it('deleteCredential calls DELETE', async () => {
    await credentials.deleteCredential('proj-1', 'cred-1')
    expect(del).toHaveBeenCalledWith('/api/v1/projects/proj-1/credentials/cred-1')
  })
})
```

**Operation 4**: Create `frontend/src/__tests__/api-deployments.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as deployments from '@/api/deployments'

vi.mock('@/api/client', () => ({
  get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn()
}))

const { get, post, patch, del } = await vi.importActual('@/api/client')

describe('deployments API', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('listEnvironments calls GET with projectId', async () => {
    await deployments.listEnvironments('proj-1')
    expect(get).toHaveBeenCalledWith('/api/v1/projects/proj-1/environments')
  })

  it('createEnvironment calls POST with name/webhook_url/branch_pattern', async () => {
    await deployments.createEnvironment('proj-1', {
      name: 'staging', webhook_url: 'https://hooks.slack.com/test',
      branch_pattern: 'main'
    })
    expect(post).toHaveBeenCalledWith('/api/v1/projects/proj-1/environments', {
      name: 'staging', webhook_url: 'https://hooks.slack.com/test',
      branch_pattern: 'main'
    })
  })

  it('deleteEnvironment calls DELETE', async () => {
    await deployments.deleteEnvironment('proj-1', 'env-1')
    expect(del).toHaveBeenCalledWith('/api/v1/projects/proj-1/environments/env-1')
  })

  it('triggerDeploy calls POST with ticketId and environment_id', async () => {
    await deployments.triggerDeploy('proj-1', { ticketId: 't-1', environment_id: 'env-1' })
    expect(post).toHaveBeenCalledWith('/api/v1/projects/proj-1/deploy', {
      ticketId: 't-1', environment_id: 'env-1'
    })
  })

  it('rollbackDeployment calls POST /:id/rollback', async () => {
    await deployments.rollbackDeployment('proj-1', 'deploy-1')
    expect(post).toHaveBeenCalledWith('/api/v1/projects/proj-1/deployments/deploy-1/rollback')
  })

  it('getDeploymentHistory passes limit and offset as query params', async () => {
    await deployments.getDeploymentHistory('proj-1', 't-1', { limit: 10, offset: 0 })
    expect(get).toHaveBeenCalledWith('/api/v1/projects/proj-1/tickets/t-1/deployments', {
      params: { limit: 10, offset: 0 }
    })
  })

  it('updateDeploymentStatus calls PATCH with status', async () => {
    await deployments.updateDeploymentStatus('proj-1', 'deploy-1', 'deployed')
    expect(patch).toHaveBeenCalledWith('/api/v1/projects/proj-1/deployments/deploy-1', {
      status: 'deployed'
    })
  })
})
```

**Operation 5**: Create `frontend/src/__tests__/api-milestones.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as milestones from '@/api/milestones'

vi.mock('@/api/client', () => ({
  get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn()
}))

const { get, post, put } = await vi.importActual('@/api/client')

describe('milestones API', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('listMilestones calls GET with projectId', async () => {
    await milestones.listMilestones('proj-1')
    expect(get).toHaveBeenCalledWith('/api/v1/projects/proj-1/milestones')
  })

  it('createMilestone calls POST with name/description/targetDate', async () => {
    await milestones.createMilestone('proj-1', { name: 'v1.0', description: 'First release', targetDate: '2026-08-01' })
    expect(post).toHaveBeenCalledWith('/api/v1/projects/proj-1/milestones', {
      name: 'v1.0', description: 'First release', targetDate: '2026-08-01'
    })
  })

  it('updateMilestone calls PUT with id in path', async () => {
    await milestones.updateMilestone('proj-1', 'ms-1', { name: 'Updated' })
    expect(put).toHaveBeenCalledWith('/api/v1/projects/proj-1/milestones/ms-1', { name: 'Updated' })
  })

  it('getMilestoneProgress calls GET /:id/progress', async () => {
    await milestones.getMilestoneProgress('proj-1', 'ms-1')
    expect(get).toHaveBeenCalledWith('/api/v1/projects/proj-1/milestones/ms-1/progress')
  })

  it('getMilestoneTickets calls GET /:id/tickets', async () => {
    await milestones.getMilestoneTickets('proj-1', 'ms-1')
    expect(get).toHaveBeenCalledWith('/api/v1/projects/proj-1/milestones/ms-1/tickets')
  })
})
```

**Operation 6**: Create `frontend/src/__tests__/api-review.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as review from '@/api/review'

vi.mock('@/api/client', () => ({
  get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn()
}))

const { get, post } = await vi.importActual('@/api/client')

describe('review API', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('getGithubDiff calls GET /:ticketId/review/diff', async () => {
    await review.getGithubDiff('t-1')
    expect(get).toHaveBeenCalledWith('/api/v1/tickets/t-1/review/diff')
  })

  it('getLocalDiff unwraps { files } envelope to return files array', async () => {
    ;(get as any).mockResolvedValue({ data: { files: [{ path: 'a.ts', action: 'added' }] } })
    const result = await review.getLocalDiff('t-1')
    expect(get).toHaveBeenCalledWith('/api/v1/tickets/t-1/review/local-diff')
    expect(result).toEqual([{ path: 'a.ts', action: 'added' }])
  })

  it('getComments calls GET with type query param defaulting to review', async () => {
    await review.getComments('t-1')
    expect(get).toHaveBeenCalledWith('/api/v1/tickets/t-1/review/comments', {
      params: { type: 'review' }
    })
  })

  it('getComments passes custom type param', async () => {
    await review.getComments('t-1', 'suggestion')
    expect(get).toHaveBeenCalledWith('/api/v1/tickets/t-1/review/comments', {
      params: { type: 'suggestion' }
    })
  })

  it('postComment calls POST with content/line/type', async () => {
    await review.postComment('t-1', { content: 'Nice code', line: 42, type: 'review' })
    expect(post).toHaveBeenCalledWith('/api/v1/tickets/t-1/review/comments', {
      content: 'Nice code', line: 42, type: 'review'
    })
  })
})
```

### Phase 3: Composable Extraction

**Operation 7**: Create `frontend/src/composables/useGitHub.ts`

Extract from `ProjectDetail.vue` lines 28-174. Copy all reactive refs and async functions. Replace `githubRepo` → `repo`, etc. Return all state and functions.

**Operation 8**: Create `frontend/src/composables/useUsage.ts`

Extract from `ProjectDetail.vue` lines 42-200. Copy `usage`, `usageLoading`, `usageError`, `billing`, `billingLoading`, `billingError` refs + `loadUsage`, `loadBilling` functions.

**Operation 9**: Create `frontend/src/composables/useMemory.ts`

Extract from `ProjectDetail.vue` lines 52-280. Copy all memory-related refs and CRUD functions.

**Operation 10**: Create `frontend/src/composables/useTabNavigation.ts`

Extract tab array and `switchTab` logic. Make it generic: accepts `TabConfig[]` array.

**Operation 11**: Modify `frontend/src/views/ProjectDetail.vue`

- Import the 4 composables
- Replace ~200 lines of inline script with composable calls
- Update template bindings (e.g., `github.loading` instead of `githubLoading`)
- Keep template identical — only script changes

### Phase 4: Composable Tests

**Operation 12**: Create `frontend/src/__tests__/useGitHub.test.ts` — 5 tests

**Operation 13**: Create `frontend/src/__tests__/useUsage.test.ts` — 3 tests

**Operation 14**: Create `frontend/src/__tests__/useMemory.test.ts` — 6 tests

**Operation 15**: Create `frontend/src/__tests__/useTabNavigation.test.ts` — 3 tests

## Out of Scope

- Tests for `src/composables/aiChatDataSource.ts` (file does not exist)
- Cypress E2E tests
- Refactoring other large views (TicketDetail.vue, etc.)

## Pending Scope Items to Present to User

- Extract logic from `TicketDetail.vue` (1190 lines) — similar treatment
- Extract logic from `AgentList.vue` (93 lines) — partially tested
- Add Cypress E2E tests for critical flows
- Test remaining API clients (agents.ts, approvals.ts, auth.ts, billing.ts, etc.)
