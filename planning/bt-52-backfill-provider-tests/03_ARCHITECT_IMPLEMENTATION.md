# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Template

**Use this template for every ticket.** Copy this file into the ticket folder and fill in the sections.

---

## Ticket: bt-52 — Backfill Provider Tests

**Status**: planned | in_progress | completed | blocked
**Priority**: P1
**Effort**: Medium
**Author**: AI Assistant
**Date created**: 2026-07-04
**Date completed**: YYYY-MM-DD
**PR**: [link]
**Branch**: [branch-name]
**Scope**: Backend | Frontend | Both

**Dependencies**: bp-52 (Unify Providers) must be completed first

---

### a) Purpose

Backfill all missing test coverage for bp-52's provider unification changes. bp-52 introduced `setDirector`, deprecated `provider_configs` routes, added partial unique index constraints, and created a data migration — but none of these have corresponding tests. Without tests, regressions in director assignment, deprecation behavior, and migration correctness are impossible to detect.

---

### b) Actions

**CRITICAL**: This is a test-only ticket. Do NOT modify any production code.

#### Implementation Order

Steps must be executed in this exact order:

1. **Backend unit test for `setDirector`** — `backend/src/__tests__/projectProviderController.test.js`
   - Study existing controller at `backend/src/controllers/projectProviderController.js`
   - Create test file with 5 test cases for `setDirector`
   - *Depends on*: nothing

2. **Backend contract test for 410 Gone** — `backend/src/__tests__/providerConfigGone.test.js`
   - Study existing routes for `provider_configs` in `backend/src/api/v1/index.js`
   - Create test file with 5+ test cases for 410 responses
   - *Depends on*: nothing

3. **Backend integration test for migration** — `backend/src/__tests__/integration/providerMigration.test.js`
   - Study existing migration SQL in `backend/src/migrations/`
   - Create integration test file with 5 test cases
   - *Depends on*: nothing (uses real PG via jest.integration.config.js)

4. **Bash integration tests** — `backend/integration-test/suites/provider-director.test.sh`
   - Study existing suite files in `backend/integration-test/suites/`
   - Create suite with 3 test functions
   - Register in `backend/integration-test/run.sh`
   - *Depends on*: nothing

5. **Frontend contract test for directorate** — `frontend/src/__tests__/api-directorate.test.ts`
   - Study existing contract tests in `frontend/src/__tests__/api-contract.test.ts`
   - Create test file with 3 test cases
   - *Depends on*: nothing

6. **Frontend component test for badge** — `frontend/cypress/component/ProjectProviderBadge.spec.ts`
   - Study existing component tests in `frontend/cypress/component/`
   - Create test file with 4 test cases
   - *Depends on*: nothing

---

### c) Per-File Action Plan

#### `backend/src/__tests__/projectProviderController.test.js` (CREATE)

```javascript
const request = require('supertest')
const app = require('../../index')
const ProjectProviderController = require('../../controllers/projectProviderController')

describe('ProjectProviderController.setDirector', () => {
  let req, res, next

  beforeEach(() => {
    req = {
      user: { id: 1, role: 'project_admin' },
      params: { projectId: 1, providerId: 1 }
    }
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    }
    next = jest.fn()
  })

  it('sets director and demotes previous director', async () => {
    // Mock: previous provider had is_director=true
    // Mock: new provider is set with is_director=true
    // Assert: res.json called with { success: true, data: { is_director: true, ... } }
  })

  it('returns current director if already set to same provider', async () => {
    // Mock: req.params.providerId matches existing director
    // Assert: res.status(200), res.json with existing director data
  })

  it('sets first provider as director when none exists', async () => {
    // Mock: no existing provider has is_director=true
    // Assert: new provider set as is_director=true
  })

  it('returns 404 for invalid project ID', async () => {
    // Mock: project doesn't exist in DB
    // Assert: res.status(404), res.json with error message
  })

  it('returns 403 for non-project-admin user', async () => {
    // Mock: user role is 'user' (not project_admin)
    // Assert: res.status(403), res.json with forbidden message
  })
})
```

#### `backend/src/__tests__/providerConfigGone.test.js` (CREATE)

```javascript
const request = require('supertest')
const app = require('../../index')

describe('Provider Config deprecation (410 Gone)', () => {
  it('GET /api/v1/provider-configs returns 410', async () => {
    const res = await request(app).get('/api/v1/provider-configs')
    expect(res.status).toBe(410)
    expect(res.body.error).toBe('Provider Config is deprecated')
  })

  it('POST /api/v1/provider-configs returns 410', async () => {
    const res = await request(app).post('/api/v1/provider-configs').send({})
    expect(res.status).toBe(410)
  })

  it('PUT /api/v1/provider-configs/:id returns 410', async () => {
    const res = await request(app).put('/api/v1/provider-configs/1').send({})
    expect(res.status).toBe(410)
  })

  it('DELETE /api/v1/provider-configs/:id returns 410', async () => {
    const res = await request(app).delete('/api/v1/provider-configs/1')
    expect(res.status).toBe(410)
  })

  it('410 response includes deprecation message and link to new endpoint', async () => {
    const res = await request(app).get('/api/v1/provider-configs')
    expect(res.body).toHaveProperty('error')
    expect(res.body.error).toContain('deprecated')
  })
})
```

#### `backend/src/__tests__/integration/providerMigration.test.js` (CREATE)

```javascript
const pool = require('../../../db')

describe('provider_configs → project_providers migration', () => {
  beforeAll(async () => {
    // Run the migration SQL file
  })

  afterAll(async () => {
    // Rollback migration
  })

  it('copies rows from provider_configs to project_providers', async () => {
    // Insert test row into provider_configs
    // Run migration
    // Query project_providers
    // Assert row exists with correct fields
  })

  it('sets first row as is_director=true', async () => {
    // Insert 2 rows into provider_configs
    // Run migration
    // Query project_providers
    // Assert first row has is_director=true, second has false
  })

  it('preserves api_key, model, base_url fields', async () => {
    // Insert row with specific api_key, model, base_url
    // Run migration
    // Assert fields match in project_providers
  })

  it('handles empty provider_configs table gracefully', async () => {
    // Ensure provider_configs is empty
    // Run migration
    // Assert no errors, project_providers unchanged
  })

  it('rollback removes migrated rows from project_providers', async () => {
    // Insert → migrate → rollback → query
    // Assert project_providers is back to original state
  })
})
```

#### `backend/integration-test/suites/provider-director.test.sh` (CREATE)

```bash
#!/usr/bin/env bash
# Tests for provider directorate and provider_configs deprecation

test_provider_directorate_set() {
  local token=$(get_auth_token)
  local res=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $token" \
    -X POST "$API_BASE/projects/1/providers/1/directorate")
  [ "$res" = "200" ] && return 0 || return 1
}

test_provider_directorate_get() {
  local token=$(get_auth_token)
  local res=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $token" \
    "$API_BASE/projects/1/providers/directorate")
  [ "$res" = "200" ] && return 0 || return 1
}

test_provider_config_410() {
  local res=$(curl -s -o /dev/null -w "%{http_code}" \
    "$API_BASE/provider-configs")
  [ "$res" = "410" ] && return 0 || return 1
}
```

Register in `backend/integration-test/run.sh` `main()` function:
```bash
test_provider_directorate_set
test_provider_directorate_get
test_provider_config_410
```

#### `frontend/src/__tests__/api-directorate.test.ts` (CREATE)

```typescript
import { describe, it, expect, vi } from 'vitest'
import * as apiClient from '@/api/client'

describe('directorate endpoint', () => {
  it('response shape matches validator schema', async () => {
    // Mock: GET /api/v1/projects/1/providers/directorate
    // Assert: response has id, name, provider_type, is_director fields
  })

  it('includes all required fields in response', async () => {
    // Mock: response with full provider data
    // Assert: all fields present and correct types
  })

  it('returns empty array when no director set', async () => {
    // Mock: GET returns empty array
    // Assert: response is []
  })
})
```

#### `frontend/cypress/component/ProjectProviderBadge.spec.ts` (CREATE)

```typescript
describe('ProjectProviderBadge', () => {
  it('renders director badge when is_director=true', () => {
    // Mount component with { is_director: true, name: 'OpenAI', provider_type: 'openai' }
    // cy.contains('Director')
    // cy.get('.badge-director').should('exist')
  })

  it('does not render badge when is_director=false', () => {
    // Mount component with { is_director: false, ... }
    // cy.contains('Director').should('not.exist')
  })

  it('shows provider name and type', () => {
    // Mount with { name: 'OpenAI', provider_type: 'openai' }
    // cy.contains('OpenAI')
    // cy.contains('openai')
  })

  it('applies design system token colors', () => {
    // Mount with is_director=true
    // cy.get('.badge-director').should('have.css', 'background-color')
    // Assert color matches CSS variable --color-primary or similar
  })
})
```

---

### d) Dependencies

- `ProjectProviderController.setDirector()` — exists from bp-52
- `provider_configs` routes returning 410 — exists from bp-52
- Migration SQL for `provider_configs` → `project_providers` — exists from bp-52
- `directorate` API endpoint — exists from bp-52
- Badge component in AI Providers tab — exists from bp-52
- Existing Jest test patterns — `backend/src/__tests__/`
- Existing Cypress component test patterns — `frontend/cypress/component/`
- Existing bash integration test patterns — `backend/integration-test/suites/`

---

### e) Risks/Edge Cases

- **[Migration test data isolation]**: Integration tests must not affect other tests. Mitigation: use transaction rollback in `afterEach`.
- **[Partial unique index testing]**: Must use raw SQL to trigger index violation. Mitigation: use `pool.query()` directly.
- **[Cypress component context]**: Badge component may depend on Pinia store. Mitigation: provide mock store via `mount()` options.

---

### f) Testing

#### Backend Unit Tests
- [ ] `backend/src/__tests__/projectProviderController.test.js` — CREATED
  - 5 test cases for `setDirector`
- [ ] `backend/src/__tests__/providerConfigGone.test.js` — CREATED
  - 5+ test cases for 410 Gone responses
- [ ] Happy path AND error paths tested (404, 403, duplicate director)
- [ ] Code coverage: run `npm run test:coverage` — no significant decrease in changed modules

#### Backend Jest Integration Tests
- [ ] `backend/src/__tests__/integration/providerMigration.test.js` — CREATED
  - 5 test cases for migration correctness
- [ ] Full request lifecycle tested
- [ ] Rollback tested

#### Backend Bash Integration Suite
- [ ] `backend/integration-test/suites/provider-director.test.sh` — CREATED
- [ ] Registered in `backend/integration-test/run.sh` `main()`
- [ ] Covers: directorate set (200), directorate get (200), provider-configs (410)

#### Frontend Unit Tests
- [ ] `frontend/src/__tests__/api-directorate.test.ts` — CREATED
  - 3 test cases for response shape
- [ ] Loading, error, and empty states tested

#### Frontend Component Tests
- [ ] `frontend/cypress/component/ProjectProviderBadge.spec.ts` — CREATED
  - 4 test cases for badge rendering
- [ ] Design system token colors verified

#### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run test:integration` — backend integration tests pass
- [ ] `cd backend && bash integration-test/run.sh --only` — bash integration suite passes
- [ ] `npm run lint` — no lint errors
- [ ] `npm run typecheck` — frontend typecheck passes
- [ ] `npm run build` — frontend build passes

---

### g) Migration Notes (if applicable)

No new migrations needed. Tests interact with existing migration from bp-52.

---

### h) Files Changed

**Backend:**
```
backend/src/__tests__/projectProviderController.test.js          → CREATE (unit tests)
backend/src/__tests__/providerConfigGone.test.js                 → CREATE (contract tests)
backend/src/__tests__/integration/providerMigration.test.js      → CREATE (integration tests)
backend/integration-test/suites/provider-director.test.sh        → CREATE (bash tests)
backend/integration-test/run.sh                                  → MODIFY (register new test functions)
```

**Frontend:**
```
frontend/src/__tests__/api-directorate.test.ts                   → CREATE (contract tests)
frontend/cypress/component/ProjectProviderBadge.spec.ts          → CREATE (component tests)
```

---

### i) Code Review Checklist

- [ ] All test files follow existing naming conventions (`*.test.js`, `*.spec.ts`)
- [ ] Backend tests use `supertest` pattern from existing contract tests
- [ ] Backend integration tests use real PG via `jest.integration.config.js`
- [ ] Bash integration tests follow existing `test_*` function pattern
- [ ] Frontend contract tests use Vitest pattern from `api-contract.test.ts`
- [ ] Frontend component tests use Cypress component pattern from existing specs
- [ ] All tests have both happy path AND error path cases
- [ ] No production code modified (test-only ticket)
- [ ] `npm test` passes with no regressions
- [ ] `npm run test:integration` passes with no regressions
- [ ] `npm test -- --run` passes for frontend
- [ ] `cd backend && bash integration-test/run.sh --only` passes

---

### j) Post-Deploy Verification

1. [ ] `npm test` passes (backend)
2. [ ] `npm run test:integration` passes (backend)
3. [ ] `cd backend && bash integration-test/run.sh --only` passes
4. [ ] `npm run lint` passes (backend)
5. [ ] `npm run lint` passes (frontend)
6. [ ] `npm run typecheck` passes (frontend)
7. [ ] `npm run build` passes (frontend)
8. [ ] `npm test -- --run` passes (frontend)
9. [ ] All 6 new test files exist and run without errors
10. [ ] No regressions in existing test suites

---

*Fill in all sections before starting implementation. Update status as work progresses.*
