# 02_ARCHITECT_DESIGN.md — Frontend API Unit Tests (Uncovered Modules)

**Status**: completed
**Date created**: 2026-06-22
**Date completed**: 2026-06-22
**Author**: AI Assistant

---

## Problem Statement

7 frontend API modules have zero unit test coverage. These are thin wrappers around `client.js` that construct URLs and select HTTP methods. Without tests, URL typos, wrong methods, or missing body fields would only be caught by Cypress e2e or in production.

## Current State

- 9 test files exist in `frontend/src/__tests__/`
- 7 API modules are completely untested: `usage.js`, `billing.js`, `providers.js`, `memory.js`, `github.js`, `ticketPlanning.js`, `ticketAttachments.js`
- `router/index.ts` is untested (but out of scope — see below)
- Existing tests use `vi.mock('../api/client')` with `await import('../api/client')` inside test bodies
- All modules follow the same pattern: import client functions → call them with endpoint + body → return result

## Design

### Test Pattern (matching existing files)

```javascript
// frontend/src/__tests__/usage.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as usage from '../api/usage'

vi.mock('../api/client', () => ({
  get: vi.fn(),
}))

describe('usage API', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('getProjectUsage', () => {
    it('sends GET request to correct URL', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue({ totalCost: 0 })

      const result = await usage.getProjectUsage('proj-123')

      expect(get).toHaveBeenCalledWith('/api/v1/usage/projects/proj-123/usage')
      expect(result).toEqual({ totalCost: 0 })
    })

    it('returns null on error', async () => {
      const { get } = await import('../api/client')
      get.mockRejectedValue(new Error('Network error'))

      const result = await usage.getProjectUsage('proj-123')

      expect(result).toBeNull()
    })
  })
})
```

### Module-by-Module Test Plan

#### 1. `usage.test.js` — 3 functions, ~6 tests

All use `get()` with `.catch()` fallbacks.

| Function | URL Pattern | Fallback |
|----------|------------|----------|
| `getProjectUsage(projectId)` | `/api/v1/usage/projects/${projectId}/usage` | `null` |
| `getUserUsage()` | `/api/v1/usage/users/me/usage` | `null` |
| `getModelPricing()` | `/api/v1/usage/pricing/models` | `[]` |

#### 2. `billing.test.js` — 2 functions, ~4 tests

All use `get()` with `.catch()` fallbacks.

| Function | URL Pattern | Fallback |
|----------|------------|----------|
| `getProjectBilling(projectId)` | `/api/v1/billing/projects/${projectId}/billing` | `null` |
| `getUserBilling()` | `/api/v1/billing/users/me/billing` | `null` |

#### 3. `providers.test.js` — 5 functions, ~10 tests

Uses `get`, `post`, `patch`, `del`.

| Function | Method | URL Pattern |
|----------|--------|------------|
| `listProviders(projectId)` | GET | `/api/v1/providers/${projectId}/providers` |
| `addProvider(projectId, name, providerType, apiKey)` | POST | `/api/v1/providers/${projectId}/providers` |
| `updateProvider(projectId, providerId, updates)` | PATCH | `/api/v1/providers/${projectId}/providers/${providerId}` |
| `deleteProvider(projectId, providerId)` | DELETE | `/api/v1/providers/${projectId}/providers/${providerId}` |
| `testProvider(projectId, providerId)` | POST | `/api/v1/providers/${projectId}/providers/${providerId}/test` |

#### 4. `memory.test.js` — 7 functions, ~14 tests

Uses `get`, `post`, `put`, `del`. **Key quirk**: `searchMemory` passes `{ params: { q: query } }` to `get()`.

| Function | Method | URL Pattern |
|----------|--------|------------|
| `getProjectMemory(projectId)` | GET | `/api/v1/memory/project/${projectId}` |
| `searchMemory(projectId, query)` | GET | `/api/v1/memory/project/${projectId}/search` + `{ params: { q: query } }` |
| `getAgentMemory(agentId)` | GET | `/api/v1/memory/agent/${agentId}` |
| `getMemory(id)` | GET | `/api/v1/memory/${id}` |
| `addMemory(projectId, content, metadata)` | POST | `/api/v1/memory/project/${projectId}` |
| `updateMemory(id, updates)` | PUT | `/api/v1/memory/${id}` |
| `deleteMemory(id)` | DELETE | `/api/v1/memory/${id}` |

#### 5. `github.test.js` — 8 functions, ~16 tests

Uses `get`, `post`, `del`.

| Function | Method | URL Pattern |
|----------|--------|------------|
| `getRepoStatus(projectId)` | GET | `/api/v1/github/${projectId}/repo` |
| `connectRepo(projectId, repoUrl, branch)` | POST | `/api/v1/github/${projectId}/repo/connect` |
| `disconnectRepo(projectId)` | DELETE | `/api/v1/github/${projectId}/repo` |
| `listBranches(projectId)` | GET | `/api/v1/github/${projectId}/branches` |
| `createBranch(ticketId, branchName)` | POST | `/api/v1/github/${ticketId}/branch` |
| `deleteBranch(ticketId)` | DELETE | `/api/v1/github/${ticketId}/branch` |
| `listPRs(projectId)` | GET | `/api/v1/github/${projectId}/prs` |
| `createPR(ticketId, title, body, branchName)` | POST | `/api/v1/github/${ticketId}/pr` |

#### 6. `ticketPlanning.test.js` — 5 functions, ~10 tests

Uses `get`, `put`, `post`, `patch`.

| Function | Method | URL Pattern |
|----------|--------|------------|
| `listPlanningFiles(ticketId)` | GET | `/api/v1/tickets/${ticketId}/planning` |
| `getPlanningFile(ticketId, fileKey)` | GET | `/api/v1/tickets/${ticketId}/planning/${fileKey}` |
| `upsertPlanningFile(ticketId, fileKey, content)` | PUT | `/api/v1/tickets/${ticketId}/planning/${fileKey}` |
| `applyTemplate(ticketId, templateName)` | POST | `/api/v1/tickets/${ticketId}/planning/apply-template` |
| `updatePlanningStatus(ticketId, status)` | PATCH | `/api/v1/tickets/${ticketId}/planning/status` |

#### 7. `ticketAttachments.test.js` — 3 functions, ~6 tests

Uses `get`, `del`, `postMultipart`. **Key quirk**: `uploadAttachment` creates a `FormData` object and passes it to `postMultipart`.

| Function | Method | URL Pattern |
|----------|--------|------------|
| `fetchAttachments(ticketId)` | GET | `/api/v1/tickets/${ticketId}/attachments` |
| `uploadAttachment(ticketId, file)` | POST (multipart) | `/api/v1/tickets/${ticketId}/attachments` |
| `deleteAttachment(ticketId, attachmentId)` | DELETE | `/api/v1/tickets/${ticketId}/attachments/${attachmentId}` |

### Alternative Designs Considered

- **Test router too** — Rejected: Vue Router requires instantiating a full Vue app (`createRouter`, `createApp`), which is heavy. Cypress e2e tests already cover navigation, guards, and route matching. The router is essentially config (route definitions), not logic.
- **Mock `global.fetch` instead of `client.js`** — Rejected: existing tests for API modules use `vi.mock('../api/client')`. Mocking `client.js` is the established pattern and avoids re-implementing auth header / error handling logic in every test.
- **One mega test file** — Rejected: mirrors the existing structure where each module has its own test file. Easier to find and update.

### Files Changed

- `frontend/src/__tests__/usage.test.js` — NEW
- `frontend/src/__tests__/billing.test.js` — NEW
- `frontend/src/__tests__/providers.test.js` — NEW
- `frontend/src/__tests__/memory.test.js` — NEW
- `frontend/src/__tests__/github.test.js` — NEW
- `frontend/src/__tests__/ticketPlanning.test.js` — NEW
- `frontend/src/__tests__/ticketAttachments.test.js` — NEW

---

## Dependencies

- **None** — self-contained change, only adds test files
- **Vitest** — already configured, picks up `src/__tests__/*.test.js`
- **`../api/client`** — already tested in `client.test.js`, mocked in all new tests

## Risks/Edge Cases

- **[FormData in uploadAttachment]**: `ticketAttachments.test.js` creates a real `FormData` object. The test just verifies `postMultipart` is called with the correct URL and a `FormData` instance — no need to validate FormData internals.
- **[Query params in searchMemory]**: `memory.test.js` must verify `{ params: { q: query } }` is passed to `get()`, not that `fetch` receives a URL-encoded string.
- **[Memory leak from vi.mock]**: `beforeEach(() => vi.clearAllMocks())` is required in each file, matching existing test pattern.

---

*Ready for implementation phase.*
