# 02_ARCHITECT_DESIGN.md — Account Lockout Design

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend + Frontend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, `04_SPECIFICATION.md`

---

## Problem Statement

Account lockout prevents brute force password attacks. Currently, the rate limiter throttles login requests (5/60s) but does not lock accounts. An attacker can make 5 attempts every 60 seconds indefinitely, potentially guessing a password given enough time.

---

## Current State

### Existing Backend
- `POST /api/auth/login` — login endpoint in `authController.js`
- `AuthService.login()` — handles credential validation
- `AuthRateLimiter` middleware — 5/60s rate limit on login
- User model has `login_attempts` column (incremented on failure, reset on success)
- No `locked_until` column — accounts never lock

### Existing Frontend
- `Login.vue` — login form with error display
- `frontend/src/api/auth.js` — login API client
- Error messages shown inline below form fields
- No lockout-specific UI currently

### Gap Analysis
- Backend: No lockout logic, no `locked_until` column, no admin unlock endpoint
- Frontend: No lockout message, no countdown timer, no 423 handling

---

## Design

### Option A: Extend Existing Structure (Recommended)

```
Database migration:
  backend/src/migrations/XXX_add_locked_until_to_users.sql
    → ALTER TABLE users ADD COLUMN locked_until TIMESTAMP;
    → Rollback: ALTER TABLE users DROP COLUMN locked_until;

AuthService changes:
  backend/src/services/AuthService.js
    → login(): After failed password check, increment login_attempts
    → If login_attempts >= 10, set locked_until = NOW() + INTERVAL '15 minutes'
    → If locked_until IS NOT NULL AND locked_until > NOW(), throw 423
    → On success, reset login_attempts = 0, locked_until = NULL

AuthController changes:
  backend/src/controllers/authController.js
    → login(): Catch 423, return { error: { code: 'ACCOUNT_LOCKED', message, lockedUntil } }

AdminController changes (NEW):
  backend/src/controllers/adminController.js
    → unlockUser(): POST /api/v1/admin/users/:id/unlock
    → Set login_attempts = 0, locked_until = NULL
    → SUPER_ADMIN only

Frontend Login.vue changes:
  frontend/src/views/Login.vue
    → Show lockout banner when error.code === 'ACCOUNT_LOCKED'
    → Countdown timer showing seconds until unlock
    → Disable submit button during lockout

Frontend auth.js changes:
  frontend/src/api/auth.js
    → Handle 423 response in login() catch block
```

### Option B: Separate Lockout Service
- Create `LockoutService.js` for lockout logic
- More modular but overkill for this feature
- Would require new service injection pattern

### Option C: Middleware-based Lockout
- Create `LockoutMiddleware.js` that checks lockout before controller
- Cleaner separation but harder to reset attempts on success
- Would need to pass lockout state through request object

**Decision**: Option A — extend existing AuthService. Simple, minimal new files, follows existing patterns.

---

## Database Schema

### Migration: `XXX_add_locked_until_to_users.sql`

```sql
ALTER TABLE users ADD COLUMN locked_until TIMESTAMP WITHOUT TIME ZONE;
```

### User table (after migration)
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL | Primary key |
| email | VARCHAR(255) | Unique |
| password_hash | VARCHAR(255) | |
| role | VARCHAR(50) | user/member/project_admin/super_admin |
| login_attempts | INTEGER | Default 0 |
| locked_until | TIMESTAMP | NULL when not locked |

---

## API Design

### Login Response (Locked)
```json
{
  "success": false,
  "error": {
    "code": "ACCOUNT_LOCKED",
    "message": "Account locked after 10 failed attempts. Try again in 12m 34s.",
    "lockedUntil": "2025-07-12T14:30:00.000Z",
    "retryAfter": 754
  }
}
```

### Admin Unlock Endpoint
```
POST /api/v1/admin/users/:id/unlock
Authorization: Bearer <token> (SUPER_ADMIN only)

Response:
{
  "success": true,
  "data": {
    "userId": 5,
    "email": "user@example.com",
    "loginAttempts": 0,
    "lockedUntil": null
  }
}
```

---

## Frontend Design

### Login.vue Lockout State

```vue
<template>
  <div v-if="lockoutActive" class="lockout-banner">
    <AlertIcon />
    <span>Account locked. Try again in {{ countdownSeconds }} seconds.</span>
  </div>
  <form v-else @submit.prevent="handleLogin">
    <!-- existing form fields -->
  </form>
</template>

<script setup>
// Countdown timer logic
// Fetch remaining time from lockedUntil response
// Update every second
// Disable form while locked
</script>
```

### Error Display
- Lockout message shown as a banner at top of form (red background)
- Form disabled while locked
- Countdown updates every second
- Form re-enables when countdown reaches 0

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Backend unit | Jest | `backend/src/__tests__/authLockout.test.js` | Lockout logic, attempt counting, auto-unlock |
| API endpoint | Jest + supertest | `backend/src/__tests__/authLockoutApi.test.js` | 423 response, unlock endpoint |
| Jest integration | Jest + real PG | `backend/src/__tests__/integration/authLockout.test.js` | Full lockout flow with DB |
| **Bash integration** | curl + helpers | `backend/integration-test/suites/auth-lockout.test.sh` | Real API responses, lockout → unlock flow |
| Frontend unit | Vitest | `frontend/src/__tests__/loginLockout.test.ts` | Countdown timer, lockout message |

### Bash Integration Suite

Add `backend/integration-test/suites/auth-lockout.test.sh`:
```bash
# 1. Register new user
# 2. Attempt 10 failed logins
# 3. Verify 423 response with lockedUntil
# 4. Verify form is disabled
# 5. Wait for lockout to expire (or manually unlock)
# 6. Verify successful login after unlock
```

---

## Risks and Edge Cases

### Backend Risks
- **[Race condition]**: Concurrent login attempts could increment attempts past 10 — Mitigation: Use atomic UPDATE with WHERE clause
- **[Timezone issues]**: locked_until is TIMESTAMP WITHOUT TIME ZONE — Mitigation: Store in UTC, display in user's timezone on frontend
- **[Stale lockout]**: If database is restored from backup, locked_until may be incorrect — Mitigation: Acceptable risk for self-hosted SaaS

### Frontend Risks
- **[Countdown drift]**: Countdown may drift if user switches tabs — Mitigation: Use absolute time from lockedUntil, not relative counter
- **[Page refresh]**: User refreshes page during lockout — Mitigation: Check auth state on mount, show lockout if token is invalid

### Edge Cases
- **[Password reset during lockout]**: User clicks "forgot password" while locked — Handle: Allow password reset even when locked (different flow)
- **[Admin unlock then immediate re-lock]**: Admin unlocks, attacker immediately tries again — Handle: Reset attempts to 0, new lockout starts fresh
- **[Clock skew]**: Database clock differs from application server — Handle: Use database time for locked_until, not application time

---

## Alternative Designs Considered

### Alternative 1: In-Memory Lockout (Redis)
- **Pros**: Faster lookups, easier to implement distributed lockout
- **Cons**: Requires Redis (new dependency), lockout lost on restart
- **Decision**: Stick with database — simpler, no new dependencies, lockout persists across restarts

### Alternative 2: Configurable Lockout Settings
- **Pros**: Flexible for different security requirements
- **Cons**: More complex, env vars to manage
- **Decision**: Hardcoded for now (10 attempts, 15 min), configurable in bp-XX-configurable-lockout

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

**If no deferred improvements are found, write: "No deferred improvements found in previous tickets."**

**All items above must be presented to the user before ticket approval.**

---

## Specification Generation

If a small model (7B–34B) will execute this ticket, the information above should be distilled into `04_SPECIFICATION.md` — a file that specifies exact file paths, imports, function signatures, test expectations, and edge cases. The small model should not need to make any architecture decisions; those are encoded in the Specification.

- [ ] `04_SPECIFICATION.md` has been created with exact file operations for each file
- [ ] Test expectations are specific (not "test it works" but "returns 400 when email is missing")
- [ ] Edge cases are enumerated explicitly
- [ ] Imports and dependencies are listed per file
- [ ] **Pending scope items presented to user**: All deferred improvements from previous tickets have been listed above and presented to the user

---

*This design document guides implementation. The "Extend Existing Structure" section is the most important — it tells the agent exactly how to add to what already exists rather than creating new code from scratch.*
