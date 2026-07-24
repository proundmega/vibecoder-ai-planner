# 01_ARCHITECT_REQUIREMENT.md — Response Validation in Production

**Status**: planned
**Date created**: 2025-07-24
**Date completed**: 
**Author**: AI Assistant
**Scope**: Frontend
**Priority**: P2 (Testing)
**Effort**: Small

---

## Requirement

The frontend API client (`client.ts`) already supports optional response validation via the `validate` option. The `validator.ts` module has `validateApiResponseStrict()` and `validateSchema()` factories. But no frontend code actually uses them. Enable response validation in production (not just tests) for critical endpoints.

---

## Existing Infrastructure Audit

### Frontend API Check
- [x] API client: `frontend/src/api/client.ts` — `extractData<T>()` accepts optional `validator?: (data: unknown) => void`
- [x] API client: `ApiOptions` interface has `validate?: (data: unknown) => void`
- [x] Validator: `frontend/src/api/validator.ts` — `validateApiResponseStrict()` throws on mismatch
- [x] Validator: `frontend/src/api/validator.ts` — `validateSchema(schemaName)` returns a validator function
- [x] Validator: `frontend/src/api/validator.ts` — `validateAndExtract<T>()` factory for strict validation
- [x] Contract test: `frontend/src/__tests__/api-contract.test.ts` — validates response shapes

### Key Insight

The plumbing is already there. The `validate` option is wired into `get()`, `post()`, `put()`, `del()`, `patch()`. We just need to:
1. Add `validate` options to critical API calls in stores
2. Make validation throw errors that stores can catch and handle gracefully

---

## Scope

### In Scope
- Add `validate` option to critical API calls in auth store and project store
- Use `validateSchema('User')`, `validateSchema('Project')`, `validateSchema('Ticket')`
- Validation errors are caught and logged (don't crash the UI)
- Tests: verify validation catches shape mismatches

### Out of Scope
- Adding validation to every API call (start with critical ones)
- Response validation on the backend (separate concern)
- Changing validator schemas (they already match backend responses)
- Frontend E2E tests (separate concern)

---

## Pending Scope Items to Present to User

All deferred improvements from previous tickets' "Out of Scope" sections that are relevant to this ticket have been presented to the user in the 01/02/03 documents above.

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `frontend/src/stores/auth.ts` | MODIFY | Add validate option to `/auth/me` call |
| `frontend/src/stores/project.ts` | MODIFY | Add validate option to project/ticket calls |
| `frontend/src/__tests__/api-contract.test.ts` | MODIFY | Extend with production validation tests |

---

## Acceptance Criteria

1. [ ] `GET /auth/me` validates response against User schema
2. [ ] `GET /projects` validates response against Project schema
3. [ ] `GET /tickets` validates response against Ticket schema
4. [ ] Validation errors are caught and logged (don't crash UI)
5. [ ] Frontend builds without errors
6. [ ] `npm run typecheck` passes
7. [ ] `npm test -- --run` passes

---

## Out of Scope

- Validation on every API call
- Backend response validation
- Changing validator schemas
- Frontend E2E tests

---

## Performance Considerations

- Schema validation is synchronous object traversal — negligible overhead
- Only adds ~1-2ms per API call
- Validation only runs on critical endpoints (not every request)

---

## Testing Checklist

### Frontend Tests
- [ ] Unit tests: verify validation catches shape mismatches
- [ ] Unit tests: verify validation is opt-in (doesn't break existing calls)
- [ ] **Coverage threshold (60%)**: `npm test -- --run --coverage`

---

*Fill in all sections before starting implementation.*
