# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend | Frontend | Both
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, bp-52 (Unify Providers)

---

## Problem Statement

bp-52 introduced significant backend and frontend changes (unified providers, project director concept, deprecated provider_configs) but no corresponding test coverage was added. Without tests, future regressions in the director assignment logic, deprecated route behavior, and data migration are impossible to detect automatically.

---

## Current State

### Existing Backend
- `ProjectProviderService.setDirector(projectId, providerId)` — sets director, demotes previous
- `ProjectProviderController.setDirector(req, res, next)` — controller wrapping the service
- Partial unique index: `CREATE UNIQUE INDEX ... WHERE is_director = true` on `project_providers`
- Old `provider_configs` routes return 410 Gone (implemented but untested)
- Migration in `backend/src/migrations/` copies `provider_configs` → `project_providers`

### Existing Frontend
- ProjectDetail.vue has "AI Providers" tab with provider list
- Badge component shows provider info (may need director indicator)
- API client calls `GET/POST /api/v1/projects/:id/providers`

### Gap Analysis
- **No tests** for `setDirector` controller method — critical business logic untested
- **No tests** for partial unique index — DB constraint unverified
- **No component tests** for merged tab/director badge — visual regression risk
- **No contract tests** for `directorate` endpoint — API contract drift risk
- **No tests** for 410 Gone responses — regression in deprecation behavior risk
- **No integration tests** for data migration — data loss risk on fresh deployments

---

## Design

### Test Architecture

All tests follow the existing patterns in the codebase:

#### Backend Unit Tests (Jest)
```
backend/src/__tests__/projectProviderController.test.js
  describe('setDirector', () => {
    beforeEach(() => { /* mock req, res, next, db */ })
    it('sets director and demotes previous', async () => { ... })
    it('returns current director if already set', async () => { ... })
    it('sets first provider as director when none exists', async () => { ... })
    it('returns 404 for invalid project', async () => { ... })
    it('returns 403 for non-project-admin', async () => { ... })
  })
```

Uses existing Jest mocks from `setupFilesAfterEnv`: pg Pool, winston, auth middleware.

#### Backend Contract Tests (Jest + supertest)
```
backend/src/__tests__/providerConfigGone.test.js
  describe('Provider Config deprecation', () => {
    it('GET /api/v1/provider-configs returns 410', async () => { ... })
    it('POST /api/v1/provider-configs returns 410', async () => { ... })
    // etc.
  })
```

Uses `supertest` against Express app (same pattern as `api-contract.test.ts`).

#### Backend Integration Tests (Jest + real PG)
```
backend/src/__tests__/integration/providerMigration.test.js
  describe('provider_configs → project_providers migration', () => {
    beforeAll(() => { /* run migration */ })
    afterAll(() => { /* rollback */ })
    it('copies rows with correct field mapping', async () => { ... })
    it('sets first row as is_director=true', async () => { ... })
    it('handles empty provider_configs gracefully', async () => { ... })
  })
```

Uses real PostgreSQL via `jest.integration.config.js`.

#### Bash Integration Tests
```
backend/integration-test/suites/provider-director.test.sh
  test_provider_directorate_set() { ... }
  test_provider_directorate_get() { ... }
  test_provider_config_410() { ... }
```

Uses curl against Docker containers + real PG (same as existing suites).

#### Frontend Contract Tests (Vitest)
```
frontend/src/__tests__/api-directorate.test.ts
  describe('directorate endpoint', () => {
    it('response shape matches validator schema', async () => { ... })
    it('includes all required fields', async () => { ... })
    it('returns empty array when no director', async () => { ... })
  })
```

Uses Vitest with mocked API client.

#### Frontend Component Tests (Cypress)
```
frontend/cypress/component/ProjectProviderBadge.spec.ts
  it('renders director badge when is_director=true', () => { ... })
  it('does not render badge when is_director=false', () => { ... })
  it('shows provider name and type', () => { ... })
```

Uses Cypress component testing with mounted Vue component + mock data.

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/__tests__/projectProviderController.test.js` | CREATE | Unit tests for `setDirector` (5 test cases) |
| `backend/src/__tests__/providerConfigGone.test.js` | CREATE | Contract tests for 410 Gone (5+ test cases) |
| `backend/src/__tests__/integration/providerMigration.test.js` | CREATE | Integration tests for data migration (5 test cases) |
| `backend/integration-test/suites/provider-director.test.sh` | CREATE | Bash tests for directorate + 410 (3 test functions) |
| `frontend/src/__tests__/api-directorate.test.ts` | CREATE | Contract tests for directorate endpoint (3 test cases) |
| `frontend/cypress/component/ProjectProviderBadge.spec.ts` | CREATE | Component tests for badge UI (4 test cases) |

---

## Data Flow Diagram

```
[Migration Test] → [run migration SQL] → [query provider_configs] → [query project_providers] → [assert rows match]

[setDirector Test] → [mock req/res] → [call controller] → [assert DB call with correct SQL] → [assert response]

[410 Test] → [supertest GET /api/v1/provider-configs] → [assert 410 status] → [assert error body]

[Badge Component Test] → [mount component with props] → [assert DOM contains "Director"] → [assert CSS class]

[Directorate Contract Test] → [mock API client response] → [assert shape matches validator schema]
```

---

## Dependencies

### Backend Dependencies
- `ProjectProviderService.setDirector()` — must exist from bp-52
- Partial unique index on `project_providers.is_director` — must exist from bp-52
- 410 Gone middleware/routes for `provider_configs` — must exist from bp-52
- Migration SQL for `provider_configs` → `project_providers` — must exist from bp-52

### Frontend Dependencies
- `directorate` API endpoint — must exist from bp-52
- Badge component in AI Providers tab — must exist from bp-52
- `validator.ts` response schemas — must match backend responses

### Cross-Cutting Dependencies
- Jest integration config (`jest.integration.config.js`) — must be configured for real PG
- Cypress component testing setup — must be configured in `frontend/cypress/`

---

## Config / Environment Changes
- No new environment variables needed
- No new database migrations needed (testing existing ones)
- No new npm dependencies needed

---

## Database Changes
No new tables or columns. Tests interact with existing `project_providers` and `provider_configs` tables.

---

## Security Considerations
- Integration tests use the existing test PG instance (`postgresql://postgres:changeme@localhost:5432/vibecode`)
- Contract tests mock auth tokens (no real tokens needed)
- Bash integration tests use Docker containers with same auth setup as CI

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Backend unit | Jest | `backend/src/__tests__/projectProviderController.test.js` | `setDirector` business logic, edge cases |
| Backend contract | Jest + supertest | `backend/src/__tests__/providerConfigGone.test.js` | 410 Gone status codes, error body shape |
| Backend integration | Jest + real PG | `backend/src/__tests__/integration/providerMigration.test.js` | Migration correctness, DB constraint enforcement |
| **Bash integration** | curl | `backend/integration-test/suites/provider-director.test.sh` | Real API responses in Docker environment |
| Frontend contract | Vitest | `frontend/src/__tests__/api-directorate.test.ts` | Response shape against `validator.ts` |
| Component | Cypress | `frontend/cypress/component/ProjectProviderBadge.spec.ts` | UI rendering, director badge visibility |

---

## Risks and Edge Cases

### Backend Risks
- **[Migration test data isolation]**: Integration tests must use a clean DB state. Mitigation: use transaction rollback after each test suite.
- **[Partial unique index testing]**: Verifying index enforcement requires attempting duplicate inserts. Mitigation: use raw SQL `INSERT` via pg Pool in test.

### Frontend Risks
- **[Component mount context]**: Cypress component tests need the full Vue app context (Pinia store, router). Mitigation: use `mount()` with full app setup from existing component tests.

### Integration Risks
- **[Test ordering]**: Migration tests must run before other provider tests. Mitigation: use `beforeAll`/`afterAll` hooks in Jest integration config.

### Edge Cases
- **[Multiple directors attempt]**: Test verifies second `setDirector` call demotes first — critical for unique index enforcement
- **[Empty provider_configs]**: Migration test verifies graceful handling when table is empty
- **[No existing director]**: `setDirector` test verifies first provider becomes director without error

---

## Alternative Designs Considered

### Alternative 1: Single combined test file
- **Pros**: Simpler file structure
- **Cons**: Violates separation of concerns (unit vs integration vs contract)
- **Decision**: Separate files follow existing codebase patterns

### Alternative 2: E2E tests instead of component tests
- **Pros**: More realistic user flow
- **Cons**: Slower, harder to isolate issues; component tests are more appropriate for badge rendering
- **Decision**: Component tests for badge, E2E not needed for this ticket

---

## Specification Generation

All test expectations are specific (not "test it works" but "returns 410 with `{ error: "Provider Config is deprecated" }`").

---

*This design document guides implementation. All tests follow existing patterns in the codebase.*
