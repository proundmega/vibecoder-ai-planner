# 01_ARCHITECT_REQUIREMENT.md — Rate Limit Countdown UI

**Status**: planned
**Date created**: 2025-07-12
**Date completed**: 
**Author**: AI Assistant
**Scope**: Backend + Frontend
**Priority**: P2 (UX)
**Effort**: Small

---

## Requirement

Show rate limit countdown UI on the frontend so users understand when they're rate-limited and when they can try again. Currently, rate-limited requests return 429 with no indication of when the limit resets. Users see a generic error and don't know how long to wait.

---

## Existing Infrastructure Audit

### Backend API Check
- [x] API route exists: `backend/src/api/routes.js` — rate-limited routes exist
- [x] Rate limiter middleware exists: `backend/src/middleware/rateLimiter.js` — existing rate limiter
- [x] Returns 429 status code — YES
- [x] Includes `Retry-After` header — YES (standard HTTP header)

### Frontend API Client Check
- [x] API client exists: `frontend/src/api/client.js` — native fetch wrapper
- [x] Handles 429 responses — NO (currently just throws generic error)

### Frontend UI Check
- [x] View components exist: Login.vue, etc. — login form exists
- [x] Error display pattern exists — inline error messages below form fields

### Key Insight

The backend already sends `Retry-After` header on 429 responses. The gap is:
1. Frontend API client doesn't extract `Retry-After` from 429 responses
2. Frontend UI doesn't show countdown to users
3. No persistent rate limit state (resets on page refresh)

---

## Scope

### In Scope
- Frontend API client extracts `Retry-After` header from 429 responses
- Frontend API client returns rate limit info to callers
- Login.vue shows rate limit countdown banner (like lockout banner)
- Any other rate-limited page shows rate limit info (register, etc.)
- Rate limit state persists during session (localStorage)
- Tests: Vitest unit tests for API client and Login.vue

### Out of Scope
- Backend changes to rate limiter (already works)
- Rate limit configuration UI
- Email notification on rate limit
- Rate limit dashboard for admins
- Rate limit exceptions for whitelisted IPs (deferred to bp-73)

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
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-76-email-notifications | ☐ |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting | ☐ |
| 3 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation | ☐ |
| 4 | bp-07-structured-logging | Log file rotation (winston-daily-rotate-file) | Observability | bp-75-log-rotation | ☐ |

**All items above must be presented to the user before ticket approval.**

---

## Deferred Improvements Found (Internal Tracking)

| # | From Ticket | Improvement | Category | Suggested Next Ticket |
|---|-------------|-------------|----------|----------------------|
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-76-email-notifications |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting |
| 3 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation |
| 4 | bp-07-structured-logging | Log file rotation (winston-daily-rotate-file) | Observability | bp-75-log-rotation |

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `frontend/src/api/client.js` | MODIFY | Extract Retry-After header from 429 responses |
| `frontend/src/views/Login.vue` | MODIFY | Show rate limit countdown banner |
| `frontend/src/views/Register.vue` | MODIFY | Show rate limit countdown banner (if register page exists) |
| `frontend/src/__tests__/rateLimitUi.test.ts` | CREATE | Unit tests for rate limit UI |

---

## Known Unknowns

1. **Which pages are rate-limited?** — Login (5/60s), Register (3/60s), /auth/me (30/60s). Need to check which frontend pages call these endpoints.
2. **Should rate limit state persist across page refresh?** — Assumed YES (localStorage), so users don't lose countdown on refresh.

---

## Important Design Decisions

**DECISION POINTS** — Items that need user confirmation.

1. **Persist rate limit state across refresh?** — YES (localStorage) — or NO (session only)? — {{localStorage / session only}}

**If no decisions need user input, write: "No design decisions require user input. All choices follow existing patterns."**

---

## Acceptance Criteria

1. [ ] [Frontend API] API client extracts `Retry-After` header from 429 responses
2. [ ] [Frontend API] API client returns rate limit info to callers
3. [ ] [Frontend UI] Login.vue shows rate limit countdown banner
4. [ ] [Frontend UI] Countdown shows "X seconds remaining"
5. [ ] [Frontend UI] Form is disabled during rate limit
6. [ ] [Frontend UI] Rate limit state persists across page refresh
7. [ ] [Frontend Tests] Unit tests for API client rate limit handling
8. [ ] [Frontend Tests] Unit tests for Login.vue rate limit UI
9. [ ] [Coverage] `npm test -- --run --coverage` passes (60% min threshold)
10. [ ] [CI] All tests pass (unit, lint, typecheck, build)

---

## Out of Scope

- Backend changes to rate limiter
- Rate limit configuration UI
- Email notification on rate limit
- Rate limit dashboard for admins
- Rate limit exceptions for whitelisted IPs (deferred to bp-73)

---

## Security Considerations

- [ ] No sensitive data leaked in rate limit messages
- [ ] Rate limit message does not reveal which endpoint was hit

---

## Testing Checklist

### Frontend Tests
- [ ] Unit tests: `frontend/src/__tests__/rateLimitUi.test.ts` — test rate limit countdown
- [ ] API client tests: test Retry-After extraction from 429 response
- [ ] Component tests: test Login.vue rate limit banner display
- [ ] Loading, error, and empty states tested

### CI Requirements
- [ ] `npm run lint` — no lint errors
- [ ] `npm run typecheck` — frontend typecheck passes
- [ ] `npm run build` — frontend build passes
- [ ] `npm test -- --run --coverage` — frontend tests + coverage pass (60%)

---

## Anti-Patterns to Avoid

- ❌ **Creating new files when existing ones can be extended** — check existing API client patterns
- ❌ **Duplicating the lockout banner** — reuse the same banner component pattern
- ❌ **Ignoring the Retry-After header** — backend already sends it, just extract it
- ❌ **Hardcoding rate limit values** — use the Retry-After header value, not hardcoded numbers
- ❌ **Skipping error handling** — all API calls must use `.catch()` or try/catch
- ❌ **Testing only happy paths** — test rate limit expiration, page refresh during rate limit

---

*Fill in all sections before starting implementation.*
