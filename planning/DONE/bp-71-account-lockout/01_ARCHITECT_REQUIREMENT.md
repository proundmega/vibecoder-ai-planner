# 01_ARCHITECT_REQUIREMENT.md — Account Lockout After Failed Login Attempts

**Status**: planned
**Date created**: 2025-07-12
**Date completed**: 
**Author**: AI Assistant
**Scope**: Backend + Frontend
**Priority**: P1 (Security)
**Effort**: Medium

---

## Requirement

Implement account lockout after N consecutive failed login attempts to prevent brute force password attacks. Currently, the rate limiter throttles login requests (5/60s) but does not lock accounts. This creates a vulnerability where an attacker can slowly guess passwords without being blocked.

---

## Existing Infrastructure Audit

### Backend API Check
- [x] API route exists: `backend/src/api/routes.js` — `/api/auth/login` exists
- [x] Controller exists: `backend/src/controllers/authController.js` — login handler exists
- [x] Service exists: `backend/src/services/AuthService.js` — login logic exists
- [x] Model exists: `backend/src/models/User.js` — User model with login attempts tracking
- [x] Validator exists: `backend/src/validators/auth.js` — Joi schemas for login
- [x] Route is mounted: `backend/src/api/routes.js` — mounted
- [x] OpenAPI JSDoc annotations exist — YES

### Frontend API Client Check
- [x] API client exists: `frontend/src/api/auth.js` — login function exists
- [x] API client functions cover all needed endpoints — YES
- [x] API client follows existing patterns — YES

### Frontend UI Check
- [x] View component exists: `frontend/src/views/Login.vue` — login form exists
- [x] Component exists: N/A — no new component needed
- [x] Route exists: `frontend/src/router/index.ts` — `/login` route exists
- [x] Existing pattern to extend — Login.vue error display

### Key Insight

The backend already has rate limiting middleware (`AuthRateLimiter`) and a `login_attempts` column on the User table. The gap is:
1. No automatic lockout after N failed attempts
2. No `locked_until` timestamp column
3. No unlock mechanism (manual via admin API, or automatic after time)
4. Frontend doesn't show lockout status to users

---

## Scope

### In Scope
- Add `locked_until` TIMESTAMP column to `users` table (migration)
- Increment `login_attempts` counter on failed login
- Set `locked_until = NOW() + INTERVAL '15 minutes'` after 10 failed attempts
- Block login if `locked_until > NOW()` (return 423 Locked)
- Reset `login_attempts` to 0 on successful login
- Reset `login_attempts` to 0 if `locked_until < NOW()` (auto-unlock)
- Backend API endpoint for admin to manually unlock: `POST /api/v1/admin/users/:id/unlock`
- Frontend: show lockout message with countdown timer on login form
- Frontend: show remaining seconds until unlock
- Tests: unit tests for lockout logic, integration test for lockout flow

### Out of Scope
- Email notification on lockout (deferred)
- IP-based lockout (deferred — see bp-XX-ip-whitelisting)
- CAPTCHA after N attempts (deferred)
- Lockout dashboard for admins (deferred)
- Configurable lockout threshold (hardcoded to 10 for now)

---

## Pending Scope Items to Present to User

**MANDATORY**: Before presenting this ticket to the user, list all deferred improvements found in previous tickets' "Out of Scope" sections that are relevant to this ticket's domain. The user must be aware of follow-up work before approving implementation.

Common goldmine categories:
- **Security**: account lockout, API key rotation/expiry, IP whitelisting
- **Observability**: Prometheus metrics, log aggregation, distributed tracing
- **Infrastructure**: S3 migration, PgBouncer, CDN caching, cache warming
- **Developer experience**: migration dry-run, env var documentation generator
- **UX**: rate limit countdown UI, usage alerts, real-time billing dashboard
- **Testing**: Cypress component tests, integration test coverage gaps

### Items to Present

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-01-rate-limit-auth | Rate limit countdown UI (show remaining time on frontend) | UX | bp-72-rate-limit-ui | ☐ |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting | ☐ |
| 3 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation | ☐ |
| 4 | bp-07-structured-logging | Log file rotation (winston-daily-rotate-file) | Observability | bp-75-log-rotation | ☐ |

**All items above must be presented to the user before ticket approval.**

---

## Deferred Improvements Found (Internal Tracking)

For internal tracking — these are the same items above but without the "User Notified" column. Create follow-up tickets for each item.

| # | From Ticket | Improvement | Category | Suggested Next Ticket |
|---|-------------|-------------|----------|----------------------|
| 1 | bp-01-rate-limit-auth | Rate limit countdown UI (show remaining time on frontend) | UX | bp-72-rate-limit-ui |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting |
| 3 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation |
| 4 | bp-07-structured-logging | Log file rotation (winston-daily-rotate-file) | Observability | bp-75-log-rotation |

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/migrations/` | NEW MIGRATION | Add `locked_until` column to `users` table |
| `backend/src/services/AuthService.js` | MODIFY | Add lockout logic to login flow |
| `backend/src/controllers/authController.js` | MODIFY | Return 423 when locked, include unlock time |
| `backend/src/api/v1/index.js` | MODIFY | Add admin unlock endpoint |
| `backend/src/controllers/adminController.js` | CREATE | Admin unlock handler |
| `backend/src/validators/auth.js` | MODIFY | Add lockout validation schema |
| `frontend/src/views/Login.vue` | MODIFY | Show lockout message with countdown |
| `frontend/src/api/auth.js` | MODIFY | Handle 423 response |

---

## Known Unknowns

1. **Should lockout be per-user or per-IP?** — Assumed per-user (simpler, matches common patterns). Per-IP would require tracking failed attempts by IP, not just username.
2. **Should there be a configurable threshold?** — Assumed hardcoded to 10 attempts, 15 min lockout. Configurable via env vars is deferred.
3. **Should admin unlock require a specific permission?** — Assumed `SUPER_ADMIN` role required.

---

## Important Design Decisions

**DECISION POINTS** — Items that need user confirmation. List only items that genuinely need user input.

1. **Lockout duration**: 15 minutes (default) — or configurable? — {{15 min default / configurable via ENV}}
2. **Admin unlock permission**: `SUPER_ADMIN` only — or allow `PROJECT_ADMIN` to unlock users in their project? — {{SUPER_ADMIN only / project-scoped unlock}}

**If no decisions need user input, write: "No design decisions require user input. All choices follow existing patterns."**

---

## Acceptance Criteria

1. [ ] [Backend API] Login returns 423 with `locked_until` timestamp when account is locked
2. [ ] [Backend API] Login resets `login_attempts` to 0 on success
3. [ ] [Backend API] Login increments `login_attempts` on failure
4. [ ] [Backend API] Account locks after 10 consecutive failed attempts
5. [ ] [Backend API] Account auto-unlocks when `locked_until` expires
6. [ ] [Backend API] `POST /api/v1/admin/users/:id/unlock` unlocks account (SUPER_ADMIN only)
7. [ ] [Backend API] Migration adds `locked_until` column to `users` table
8. [ ] [Frontend UI] Login form shows lockout message with countdown timer
9. [ ] [Frontend UI] Frontend handles 423 response from backend
10. [ ] [Backend Tests] Unit tests for lockout logic in AuthService
11. [ ] [Integration Tests] Integration test for lockout flow (10 failures → locked → auto-unlock)
12. [ ] [Bash Integration] Bash integration test for lockout scenario
13. [ ] [Coverage] `npm run test:coverage` passes (60% min threshold)
14. [ ] [CI] All tests pass (unit, integration, lint, typecheck)

---

## Out of Scope

- Email notification on lockout
- IP-based lockout (deferred to bp-73)
- CAPTCHA after N attempts
- Lockout dashboard for admins
- Configurable lockout threshold (hardcoded to 10 for now)
- Rate limit countdown UI (deferred to bp-72)

---

## Performance Considerations

- Expected load: Minimal — lockout check is a single UPDATE/SELECT on users table
- N+1 queries to avoid: None
- Caching strategy: None needed
- Pagination needed: NO

---

## Security Considerations

- [x] Authentication required: YES — login endpoint
- [x] Authorization check: YES — admin unlock requires SUPER_ADMIN role
- [x] Input validation: YES — Joi validation on login payload
- [x] Rate limiting: YES — existing AuthRateLimiter (5/60s)
- [x] Sensitive data handling: YES — lockout status should not reveal if user exists (prevent enumeration)

---

## Testing Checklist

### Test-First Requirement (if 04_SPECIFICATION.md exists)

- [ ] Empty test stub files created BEFORE any production code (listed as first file operations)
- [ ] Test stubs contain imports, `describe` blocks, and stub `it` blocks
- [ ] After implementation: test stubs filled in with actual assertions

### Backend Tests
- [ ] Unit tests: `backend/src/__tests__/authLockout.test.js` — test lockout logic in AuthService
- [ ] Unit tests: test increment, lock, unlock, auto-unlock, reset on success
- [ ] API endpoint tests: `backend/src/__tests__/authLockoutApi.test.js` — test 423 response
- [ ] Jest integration tests: test lockout flow with real DB
- [ ] **Bash integration suite**: test added in `backend/integration-test/suites/auth-lockout.test.sh`
- [ ] Every new controller method has at least one test case
- [ ] Every new service method has at least one test case
- [ ] Happy path AND error paths tested (not just happy path)
- [ ] **Coverage threshold (60%)**: `npm run test:coverage` — min 60% lines, functions, branches, statements

### Frontend Tests
- [ ] Unit tests: `frontend/src/__tests__/loginLockout.test.ts` — test lockout message display
- [ ] Component tests: test countdown timer, lockout message rendering
- [ ] Loading, error, and empty states tested

### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run test:coverage` — backend coverage threshold passes (60%)
- [ ] `npm run test:integration` — backend integration tests pass
- [ ] `cd backend && bash integration-test/run.sh --only` — bash integration suite passes
- [ ] `npm run lint` — no lint errors
- [ ] `npm run typecheck` — frontend typecheck passes
- [ ] `npm run build` — frontend build passes
- [ ] `npm test -- --run --coverage` — frontend tests + coverage pass (60%)

---

## Anti-Patterns to Avoid

- ❌ **Creating new files when existing ones can be extended** — check `frontend/src/api/`, `frontend/src/views/`, `frontend/src/components/` before creating
- ❌ **Duplicating existing patterns** — follow the style of `frontend/src/api/tickets.js`, `frontend/src/api/projects.js`, etc.
- ❌ **Ignoring the existing tab structure** — if `ProjectDetail.vue` has tabs, add new features as tabs, not new pages
- ❌ **Creating new API clients from scratch** — use the same `get`, `post`, `put`, `del`, `patch` imports from `./client`
- ❌ **Ignoring OpenAPI spec** — if backend routes change, update JSDoc and regenerate frontend types
- ❌ **Snake_case/camelCase mismatches** — backend uses snake_case, frontend API clients must convert to camelCase
- ❌ **Hardcoding API paths** — use the same pattern as existing API clients
- ❌ **Skipping error handling** — all API calls must use `.catch()` or try/catch
- ❌ **Testing only happy paths** — test error cases, empty states, loading states
- ❌ **Merging without tests** — every change must have tests
- ❌ **No bash integration test for backend changes** — add curl-based test in `backend/integration-test/suites/`
- ❌ **Skipping the bash integration suite** — `backend/integration-test/run.sh --only` should pass
- ❌ **Response validation not updated** — if backend response shapes change, update `frontend/src/api/validator.ts`
- ❌ **Contract test not updated** — if a field name, type, or enum changes in an API response
- ❌ **Generated types stale** — after OpenAPI spec changes, regenerate types and verify they compile
- ❌ **Ignoring coverage threshold** — CI enforces 60% min; run `npm run test:coverage` locally before pushing
- ❌ **Skipping the Specification file** — if a small model will execute this ticket, fill out `04_SPECIFICATION.md`
- ❌ **Skipping test stubs** — when `04_SPECIFICATION.md` exists, create test stubs BEFORE production code

---

*Fill in all sections before starting implementation. The existing infrastructure audit is the most important section — it prevents agents from creating redundant code.*
