# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: planned
**Date created**: 2026-08-12
**Date completed**:
**Author**: AI Assistant
**Scope**: Backend
**Priority**: P2
**Effort**: Medium
**Parent ticket**: fg-13 (FE↔BE API surface audit)

---

## Requirement

The full FE↔BE API surface audit (fg-13) found that while request body validation exists for most endpoints via Joi schemas, **query parameters, path parameters, and request headers have no validation**. Response schemas are also unvalidated in production. This ticket adds comprehensive input/output validation to close these gaps.

**Current behavior**:
- Query parameters (`?page=`, `?limit=`, `?status=`) are used but never validated — NaN values, negative numbers, or unexpected types pass through to SQL queries
- Path parameters (`:id`) are parsed with `parseInt()` but never validated for valid ranges or types — non-numeric strings become `NaN`
- Request headers (`Content-Type`, `Accept`) are not validated
- Response schemas are validated only in test mode, not in production

**Expected behavior**:
- Query parameters are validated against Joi schemas before reaching controllers
- Path parameters are validated for numeric integrity
- Request headers are validated for required fields
- Response schema validation is enabled in production (configurable)

The 4 findings from the fg-13 audit:

| # | Finding | Description | Impact |
|---|---------|-------------|--------|
| Q1 | **Query parameter validation** — `?page=`, `?limit=`, `?status=` have no Joi validation | P1 — NaN values pass through to SQL, negative limits cause errors, unexpected query params silently ignored |
| Q2 | **Path parameter validation** — `:id` params parsed with `parseInt()` but never validated for valid ranges | P2 — `NaN` propagates to SQL where it may cause unexpected behavior (e.g., `WHERE id = NaN` returns 0 rows) |
| Q3 | **Request header validation** — `Content-Type`, `Accept` headers not validated | P3 — Low impact, but inconsistent headers can cause downstream issues |
| Q4 | **Response schema validation in production** — validator.ts only validates in test mode | P2 — Production errors may return malformed responses to clients |

---

## Existing Infrastructure Audit

### Backend API Check

- [x] Joi schemas exist in `backend/src/validators/` — YES (15 schemas covering request bodies)
- [x] Validation middleware exists — YES, `backend/src/middleware/validate.js` wraps Joi schemas
- [x] Response validation exists — YES, `frontend/src/api/validator.ts` validates responses but only in test mode
- [x] Permission codes exist — YES, 26 codes in `005_permission_system.sql`
- [x] OpenAPI JSDoc annotations exist — YES, most routes have JSDoc

### Key Insight

This is a **BACKEND-ONLY** ticket. All changes are in the backend validation layer:
- Q1: Extend `validate.js` middleware to support query param schemas
- Q2: Add path param validation helper
- Q3: Add header validation to `validate.js`
- Q4: Enable production response validation (configurable via env var)

---

## Scope

### In Scope
- Q1: Extend `middleware/validate.js` to support `query` schemas (in addition to existing `body` schemas)
- Q2: Add path parameter validation — create `validatePathParams()` helper that validates `:id` params are valid integers
- Q3: Add request header validation — validate `Content-Type: application/json` for POST/PUT/PATCH requests
- Q4: Enable response schema validation in production via `RESPONSE_VALIDATION=true` env var (currently only `NODE_ENV=test`)
- Joi schemas for common query patterns: pagination (`page`, `limit`), status filters, sort parameters
- Tests for all 4 findings
- Regression tests for existing endpoints that rely on query params

### Out of Scope
- File upload validation (not currently supported)
- Validation of nested objects beyond 1-2 levels (deferred — Joi supports it but scope is limited)
- Runtime type coercion (Joi `coerce` option — keep input types strict per existing pattern)
- Validation of request bodies beyond existing schemas (already covered by Joi)
- Response body validation schemas for every endpoint (validation is structural, not semantic)
- Frontend changes (response validation is backend-only)

---

## Pending Scope Items to Present to User

**MANDATORY**: Before presenting this ticket to the user, list all deferred improvements found in previous tickets' "Out of Scope" sections that are relevant to this ticket's domain.

### Items to Present

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | fg-13 | `postWithHeaders` in `client.ts` has zero production call sites (tests only) — dead export | Developer experience | bp-XX-dead-code-cleanup | ☐ |
| 2 | fg-13 | Route-mount drift — no audit script to catch unmounted routers | Developer experience | bp-XX-route-mount-audit | ☐ |
| 3 | bp-06 (input validation) | Query parameter validation (this ticket) | API | fg-14 | ☐ |
| 4 | bp-06 (input validation) | Path parameter validation (this ticket) | API | fg-14 | ☐ |
| 5 | bp-06 (input validation) | Validation of nested objects beyond 1-2 levels | API | bp-XX-nested-validation | ☐ |
| 6 | bp-06 (input validation) | Runtime type coercion (Joi `coerce`) | API | bp-XX-type-coercion | ☐ |
| 7 | bp-06 (input validation) | Response schema validation in production | API | fg-14 | ☐ |
| 8 | bp-06 (input validation) | Request header validation | API | fg-14 | ☐ |
| 9 | bp-11 (API caching) | Cache analytics dashboard | Observability | bp-XX-cache-analytics | ☐ |
| 10 | bp-11 (API caching) | CDN-level caching (CloudFront, Cloudflare) | Infrastructure | bp-XX-cdn-caching | ☐ |

**All items above must be presented to the user before ticket approval.**

---

## Deferred Improvements Found (Internal Tracking)

| # | From Ticket | Improvement | Category | Suggested Next Ticket |
|---|-------------|-------------|----------|----------------------|
| 1 | bp-06 | Validation of nested objects beyond 1-2 levels | API | bp-XX-nested-validation |
| 2 | bp-06 | Runtime type coercion (Joi `coerce`) | API | bp-XX-type-coercion |
| 3 | bp-11 | Cache analytics dashboard | Observability | bp-XX-cache-analytics |
| 4 | bp-11 | CDN-level caching | Infrastructure | bp-XX-cdn-caching |
| 5 | bp-11 | Cache penetration protection (bloom filters) | Infrastructure | bp-XX-cache-protection |
| 6 | bp-11 | Cache stampede protection (single-flight) | Infrastructure | bp-XX-cache-stampede |
| 7 | bp-11 | Cache invalidation via webhooks | Infrastructure | bp-XX-cache-webhooks |

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/middleware/validate.js` | MODIFY | Add `query` and `headers` schema support; add `validatePathParams()` helper |
| `backend/src/validators/` | CREATE | New Joi schemas for common query patterns (`pagination.js`, `statusFilter.js`) |
| `backend/src/api/v1/index.js` | MODIFY | Apply query validation to routes that accept query params (tickets, agents, usage, etc.) |
| `backend/src/__tests__/validate.test.js` | CREATE/EXTEND | Tests for query, path, header validation |
| `config` | MODIFY | Add `RESPONSE_VALIDATION` env var (default: false for backward compat) |
| `database` | NONE | No migrations needed |

---

## Known Unknowns

1. **[Q3 header validation]**: Should `Content-Type` validation be strict (`application/json` only) or lenient (`application/json`, `multipart/form-data`)? **Resolution**: strict — all API endpoints use JSON, no file upload support yet.
2. **[Q4 response validation]**: Should response validation fail the request or just log? **Resolution**: log only in production (failures are soft), fail in test mode (existing behavior).
3. **[Performance]**: Will adding validation to every request add measurable latency? **Resolution**: Joi is fast (~0.1ms per validation); benchmark before/merge.

---

## Important Design Decisions

**No design decisions require user input. All choices follow existing patterns.**

- Q1: Follow existing `validate` middleware pattern (Joi schema → `next(err)` on failure)
- Q2: Path params validated at middleware layer, before controller execution
- Q3: `Content-Type` must be `application/json` for POST/PUT/PATCH (existing pattern)
- Q4: `RESPONSE_VALIDATION` env var defaults to `false` (backward compatible)

**If no decisions need user input, write: "No design decisions require user input. All choices follow existing patterns."**

---

## Acceptance Criteria

1. [ ] [Query Params] Q1: `middleware/validate.js` supports `query` schemas (tested with pagination params)
2. [ ] [Query Params] Q1: `?page=abc` returns 400 (not NaN in SQL); `?limit=-1` returns 400
3. [ ] [Path Params] Q2: `:id` params validated as integers; non-numeric `:id` returns 400
4. [ ] [Headers] Q3: POST/PUT/PATCH without `Content-Type: application/json` returns 400
5. [ ] [Response] Q4: `RESPONSE_VALIDATION=true` enables response schema validation in production
6. [ ] [Response] Q4: Response validation failures are logged but do not crash the request (production)
7. [ ] [Tests] All 4 findings have regression tests in `validate.test.js`
8. [ ] [Tests] Existing endpoints that use query params still work (no regression)
9. [ ] [Coverage] `npm run test:coverage` passes 60% min
10. [ ] [Lint] `npm run lint` passes with no errors

---

## Out of Scope

- File upload validation (not currently supported)
- Validation of nested objects beyond 1-2 levels deep
- Runtime type coercion (Joi `coerce` option — keep input types strict)
- Frontend changes (response validation is backend-only)
- Response body semantic validation (structure only, not business logic)
- Validation of WebSocket messages (separate concern)

---

## Performance Considerations

- Joi validation adds ~0.1ms per request (measured in existing tests)
- Query validation applied to ~20 routes that accept query params
- Path validation applied to all routes with `:id` params (~50 routes)
- Header validation applied to ~30 POST/PUT/PATCH routes
- Response validation (when enabled) adds ~0.2ms per response
- **Total estimated overhead**: <0.5ms per request (negligible)

---

## Security Considerations

- [x] Input validation prevents SQL injection via malformed query params — YES, Joi validates types/ranges
- [x] Path parameter validation prevents SQL injection via `:id` — YES, validates integer type
- [x] Content-Type validation prevents MIME-type confusion — YES, strict `application/json` for JSON endpoints
- [ ] Rate limiting: N/A (validation is separate from rate limiting)
- [x] Sensitive data handling: N/A — validation does not expose secrets

---

## Testing Checklist

### Backend Tests
- [x] Unit test files CREATED/EXTENDED — `backend/src/__tests__/validate.test.js` extended
- [x] Unit tests: `backend/src/__tests__/unit.test.js` — query/path/header validation scenarios
- [x] Every new Joi schema has at least one test case
- [x] Happy path AND error paths tested (not just happy path)
- [x] **Coverage threshold (60%)**: `npm run test:coverage` — min 60% lines, functions, branches, statements

### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run test:coverage` — backend coverage threshold passes (60%)
- [ ] `npm run test:integration` — backend integration tests pass (if applicable)
- [ ] `cd backend && bash integration-test/run.sh --only` — bash integration suite passes
- [ ] `npm run lint` — no lint errors

---

## Anti-Patterns to Avoid

- ❌ **Adding a separate validation middleware for each route** — extend the existing `validate.js` middleware
- ❌ **Hardcoding validation logic in controllers** — all validation goes in middleware/joi schemas
- ❌ **Changing existing Joi schemas without tests** — extend, don't modify existing schemas
- ❌ **Skipping regression tests** — every existing endpoint that uses query params needs a regression test
- ❌ **Breaking backward compatibility** — `RESPONSE_VALIDATION` defaults to `false`
- ❌ **Ignoring coverage threshold** — CI enforces 60% min; run coverage locally before pushing

---

*Fill in all sections before starting implementation. The existing infrastructure audit is the most important section — it prevents agents from creating redundant code.*
