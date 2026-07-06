# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: planned
**Date created**: 2026-07-04
**Date completed**: {{YYYY-MM-DD}}
**Author**: AI Assistant
**Scope**: Backend | Frontend | Both
**Priority**: P1
**Effort**: Medium
**Related**: bp-52 (Unify Providers)

---

## Requirement

bp-52 unified `provider_configs` and `project_providers` into a single AI Providers system with a "Project Director" concept. However, the testing coverage for this change is incomplete — several critical code paths have zero test coverage and no regression tests exist.

This ticket backfills all missing test coverage for the bp-52 provider unification changes, ensuring every new controller method, new DB constraint, new UI component, and new API endpoint has corresponding test coverage.

---

## Existing Infrastructure Audit

**CRITICAL**: Before planning, audit what already exists. Do NOT create new code if existing code can be extended.

### Backend API Check
- [ ] API route exists: `backend/src/api/` — YES (providers routes in `backend/src/api/v1/index.js`)
- [ ] Controller exists: `backend/src/controllers/` — YES (`projectProviderController.js` with `setDirector`)
- [ ] Service exists: `backend/src/services/` — YES (`ProjectProviderService.js`)
- [ ] Model exists: `backend/src/models/` — YES (`projectProvider.js`)
- [ ] Validator exists: `backend/src/validators/` — verify
- [ ] Route is mounted: `backend/src/api/v1/index.js` — YES
- [ ] OpenAPI JSDoc annotations exist — verify

### Frontend API Client Check
- [ ] API client exists: `frontend/src/api/` — verify
- [ ] API client functions cover all needed endpoints — verify
- [ ] API client follows existing patterns — verify

### Frontend UI Check
- [ ] View component exists: `frontend/src/views/` — YES (ProjectDetail.vue has AI Providers tab)
- [ ] Component exists: `frontend/src/components/` — verify (badge/tab merged UI)
- [ ] Route exists: `frontend/src/router/index.ts` — YES
- [ ] Existing tab/section where this can be added — ProjectDetail.vue AI Providers tab
- [ ] Existing modal/pattern to extend — verify

### Integration Check
- [ ] Frontend API client can call existing backend endpoints — verify
- [ ] Response shapes match (snake_case vs camelCase) — verify
- [ ] Auth tokens are used correctly — verify
- [ ] Error handling matches existing patterns — verify

### Key Insight

This is a **test-only** ticket. All production code from bp-52 already exists. The task is to create test files that cover:
1. `setDirector` controller method (backend unit test)
2. Partial unique index constraint (DB-level integration test)
3. Merged tab/director badge UI (frontend component test)
4. `directorate` endpoint (contract/API test)
5. Old Provider Config routes returning 410 Gone (contract test)
6. Data migration from `provider_configs` to `project_providers` (integration test)

---

## Scope

### In Scope
- Create `backend/src/__tests__/projectProviderController.test.js` — test `setDirector` method
- Create DB-level test for partial unique index constraint on `project_providers.is_director`
- Create `frontend/cypress/component/ProjectProviderBadge.spec.ts` — test merged tab/director badge UI
- Create `frontend/src/__tests__/api-directorate.test.ts` — contract test for `directorate` endpoint
- Create `backend/src/__tests__/providerConfigGone.test.js` — verify old Provider Config routes return 410
- Create `backend/src/__tests__/integration/providerMigration.test.js` — test data migration from `provider_configs` to `project_providers`
- Extend `backend/integration-test/suites/` with bash tests for director and 410 responses

### Out of Scope
- Modifying any production code from bp-52
- Creating tests for unrelated provider functionality
- Changes to the migration scripts themselves (only testing their effects)

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/__tests__/projectProviderController.test.js` | CREATE | Unit tests for `setDirector` |
| `backend/src/__tests__/integration/providerMigration.test.js` | CREATE | Integration test for data migration |
| `backend/src/__tests__/providerConfigGone.test.js` | CREATE | Contract test for 410 Gone responses |
| `backend/integration-test/suites/` | EXTEND | Add bash tests for director and 410 |
| `frontend/src/__tests__/api-directorate.test.ts` | CREATE | Contract test for directorate endpoint |
| `frontend/cypress/component/ProjectProviderBadge.spec.ts` | CREATE | Component test for badge UI |

---

## Known Unknowns

Things that could change the approach if the answer is different from assumed:

1. **[Existing test file locations]**: Which existing test files already cover partial provider tests? Need to check `backend/src/__tests__/` and `frontend/src/__tests__/` before creating new files.
2. **[Migration test approach]**: Does the existing integration test setup in `backend/src/__tests__/jest.integration.config.js` support running migrations before tests?

---

## Important Design Decisions

**No design decisions require user input. All choices follow existing patterns.**

---

## Acceptance Criteria

1. [ ] `setDirector` controller method has at least 4 test cases: success, already-director, no-director-yet, invalid-project-id
2. [ ] Partial unique index test verifies only one `is_director=true` per `project_id` at DB level
3. [ ] Frontend component test renders badge with director indicator when provider is director
4. [ ] `directorate` endpoint contract test verifies response shape matches `validator.ts` schema
5. [ ] All old `provider_configs` routes return HTTP 410 Gone with `{ error: "Provider Config is deprecated" }`
6. [ ] Migration integration test verifies `provider_configs` rows are copied to `project_providers` with correct field mapping
7. [ ] `npm test` passes with no regressions
8. [ ] `npm run test:integration` passes with no regressions
9. [ ] `npm test -- --run` passes for frontend
10. [ ] `cd backend && bash integration-test/run.sh --only` passes

---

## Testing Checklist

### Backend Tests
- [ ] Unit test: `backend/src/__tests__/projectProviderController.test.js` — CREATED
  - Test `setDirector`: success case (sets director, demotes previous)
  - Test `setDirector`: already-director case (no-op, returns current director)
  - Test `setDirector`: no-director-yet case (first provider becomes director)
  - Test `setDirector`: invalid project ID (returns 404)
  - Test `setDirector`: permission denied for non-project-admin
- [ ] Contract test: `backend/src/__tests__/providerConfigGone.test.js` — CREATED
  - Test `GET /api/v1/provider-configs` returns 410
  - Test `POST /api/v1/provider-configs` returns 410
  - Test `PUT /api/v1/provider-configs/:id` returns 410
  - Test `DELETE /api/v1/provider-configs/:id` returns 410
  - Test response body includes `{"error": "Provider Config is deprecated"}`
- [ ] Integration test: `backend/src/__tests__/integration/providerMigration.test.js` — CREATED
  - Test migration copies `provider_configs` → `project_providers`
  - Test migration sets first row as `is_director=true`
  - Test migration preserves `api_key`, `model`, `base_url` fields
  - Test migration handles empty `provider_configs` table gracefully
  - Test rollback reverses migration (rows removed from `project_providers`)
- [ ] **Bash integration suite**: `backend/integration-test/suites/provider-director.test.sh` — CREATED
  - Test `POST /api/v1/projects/:id/providers/:id/directorate` returns 200
  - Test `GET /api/v1/projects/:id/providers/directorate` returns 200
  - Test old `GET /api/v1/provider-configs` returns 410

### Frontend Tests
- [ ] Contract test: `frontend/src/__tests__/api-directorate.test.ts` — CREATED
  - Test `GET /api/v1/projects/:id/providers/directorate` response shape
  - Test response includes `id`, `name`, `provider_type`, `is_director` fields
  - Test empty response when no director set
- [ ] Component test: `frontend/cypress/component/ProjectProviderBadge.spec.ts` — CREATED
  - Test badge renders with "Director" label when `is_director=true`
  - Test badge does not render when `is_director=false`
  - Test badge shows provider name and type
  - Test badge styling matches design system tokens

### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run test:integration` — backend integration tests pass
- [ ] `cd backend && bash integration-test/run.sh --only` — bash integration suite passes
- [ ] `npm run lint` — no lint errors
- [ ] `npm run typecheck` — frontend typecheck passes
- [ ] `npm run build` — frontend build passes

---

## Anti-Patterns to Avoid

- ❌ **Testing only happy paths** — test error cases (404, 403, 410, duplicate director)
- ❌ **Creating new production code** — this is a test-only ticket
- ❌ **Skipping the bash integration suite** — API changes need curl-based tests
- ❌ **Contract test not updated** — response shapes must match `validator.ts`
- ❌ **No regression test** — every new test must verify the specific bp-52 behavior

---

*Fill in all sections before starting implementation. The existing infrastructure audit is the most important section — it prevents agents from creating redundant code.*
