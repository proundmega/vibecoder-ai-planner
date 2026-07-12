# 02_ARCHITECT_DESIGN.md — Rate Limit Countdown UI Design

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Frontend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, `04_SPECIFICATION.md`

---

## Problem Statement

Rate limited requests return 429 with no indication of when the limit resets. Users see a generic error and don't know how long to wait. The backend already sends `Retry-After` header on 429 responses, but the frontend doesn't extract or display it.

---

## Current State

### Existing Backend
- `AuthRateLimiter` middleware — rate limits login (5/60s), register (3/60s), /auth/me (30/60s)
- Returns 429 status with `Retry-After` header on rate limit exceeded
- No frontend integration with rate limit headers

### Existing Frontend
- `frontend/src/api/client.js` — native `fetch` wrapper, does NOT extract `Retry-After` header
- `Login.vue` — shows inline error messages, no rate limit specific UI
- `Register.vue` — exists (if register page exists), no rate limit specific UI
- No rate limit state persistence (localStorage)

### Gap Analysis
- Frontend API client doesn't extract `Retry-After` from 429 responses
- Frontend UI doesn't show countdown to users
- No persistent rate limit state (resets on page refresh)

---

## Design

### Option A: Extend Existing API Client (Recommended)

```
Frontend API client changes:
  frontend/src/api/client.js
    → Extract Retry-After header from 429 responses
    → Attach rate limit info to error object
    → Store rate limit state in localStorage for persistence

Frontend Login.vue changes:
  frontend/src/views/Login.vue
    → Show rate limit countdown banner (similar to lockout banner)
    → Disable submit button during rate limit
    → Countdown shows "X seconds remaining"

Frontend Register.vue changes:
  frontend/src/views/Register.vue
    → Show rate limit countdown banner (if register page exists)
    → Reuse same banner component pattern

Frontend rate limit store (NEW):
  frontend/src/stores/rateLimit.ts
    → Singleton Pinia store for rate limit state
    → Persist to localStorage
    → Countdown timer management
```

### Option B: Inline Rate Limit Handling
- Handle rate limit in each component individually
- More duplication, less reusable
- No shared state management

### Option C: Axios Interceptor Pattern
- Use axios interceptor (axios is a transitive dep but unused)
- Would require switching from native fetch to axios
- Overkill for this feature

**Decision**: Option A — extend existing API client. Minimal new files, follows existing patterns (native fetch, localStorage for state).

---

## API Design

### 429 Response with Retry-After (Backend — unchanged)
```
HTTP/1.1 429 Too Many Requests
Retry-After: 45

{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Please try again in 45 seconds."
  }
}
```

### Frontend Error Shape (New)
```typescript
interface RateLimitError {
  success: false;
  error: {
    code: 'RATE_LIMITED';
    message: string;
    retryAfter: number; // seconds from Retry-After header
    retryAt: string; // ISO timestamp
  };
}
```

---

## Frontend Design

### Rate Limit Banner Component Pattern

```vue
<template>
  <div v-if="rateLimitActive" class="rate-limit-banner">
    <svg class="rate-limit-icon"><!-- ClockIcon --></svg>
    <span>Too many requests. Try again in {{ countdownSeconds }}s.</span>
  </div>
  <form v-else @submit.prevent="handleSubmit">
    <!-- existing form fields -->
  </form>
</template>

<script setup>
// Rate limit state from store or localStorage
// Countdown timer logic
// Disable form while rate limited
</script>
```

### Error Display
- Rate limit message shown as a banner at top of form (yellow/amber background)
- Form disabled while rate limited
- Countdown updates every second
- Form re-enables when countdown reaches 0
- Rate limit state persists across page refresh (localStorage)

### Rate Limit Store (`frontend/src/stores/rateLimit.ts`)

```typescript
import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useRateLimitStore = defineStore('rateLimit', () => {
  const rateLimitActive = ref(false);
  const retryAt = ref<string | null>(null);
  const countdownSeconds = ref(0);

  function setRateLimit(retryAfter: number) {
    rateLimitActive.value = true;
    retryAt.value = new Date(Date.now() + retryAfter * 1000).toISOString();
    countdownSeconds.value = retryAfter;
    localStorage.setItem('rateLimitActive', 'true');
    localStorage.setItem('rateLimitRetryAt', retryAt.value);
    startCountdown();
  }

  function clearRateLimit() {
    rateLimitActive.value = false;
    retryAt.value = null;
    countdownSeconds.value = 0;
    localStorage.removeItem('rateLimitActive');
    localStorage.removeItem('rateLimitRetryAt');
  }

  function startCountdown() {
    // Countdown logic using retryAt absolute time
  }

  function restoreFromStorage() {
    // Restore state from localStorage on mount
  }

  return { rateLimitActive, retryAt, countdownSeconds, setRateLimit, clearRateLimit, restoreFromStorage };
});
```

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Frontend unit | Vitest | `frontend/src/__tests__/rateLimitClient.test.ts` | Retry-After extraction from 429 responses |
| Frontend unit | Vitest | `frontend/src/__tests__/rateLimitUi.test.ts` | Countdown timer, rate limit banner |
| Cypress component | Cypress | `cypress/component/RateLimitBanner.cy.ts` | Banner display, countdown, form disable |

### Frontend Test Cases

```typescript
// rateLimitClient.test.ts
describe('API client - Rate limit handling', () => {
  it('extracts Retry-After header from 429 response', async () => {
    // Mock fetch returning 429 with Retry-After: 45
    // Assert error includes retryAfter: 45
  });

  it('returns rate limit info in error object', async () => {
    // Mock fetch returning 429
    // Assert error has { code, message, retryAfter, retryAt }
  });
});

// rateLimitUi.test.ts
describe('Login.vue - Rate limit UI', () => {
  it('shows rate limit banner when rate limited', async () => {
    // Mock API to return 429
    // Mount component
    // Assert banner is visible
  });

  it('disables form during rate limit', async () => {
    // Mock API to return 429
    // Mount component
    // Assert submit button is disabled
  });

  it('updates countdown every second', async () => {
    // Mock API to return 429 with Retry-After: 60
    // Mount component
    // Wait 2s
    // Assert countdown decreased by 2
  });

  it('re-enables form when countdown reaches 0', async () => {
    // Mock Retry-After to be 1s
    // Mount component
    // Wait for countdown
    // Assert form is re-enabled
  });

  it('persists rate limit state across page refresh', async () => {
    // Set localStorage with rate limit state
    // Mount component
    // Assert banner is visible immediately
  });
});
```

---

## Risks and Edge Cases

### Frontend Risks
- **[Countdown drift]**: Countdown may drift if user switches tabs — Mitigation: Use absolute time from retryAt, not relative counter
- **[Page refresh]**: User refreshes page during rate limit — Mitigation: Restore state from localStorage on component mount
- **[Multiple rate limits]**: Different endpoints have different rate limits (login 5/60s, register 3/60s) — Mitigation: Use the highest Retry-After value

### Edge Cases
- **[Retry-After header missing]**: Backend doesn't send Retry-After — Handle: Default to 60 seconds
- **[Rate limit during countdown]**: User hits rate limit again while already rate limited — Handle: Reset countdown to new Retry-After value
- **[Clock skew]**: Client clock differs from server — Handle: Use server's retryAt timestamp, not client-relative countdown

---

## Alternative Designs Considered

### Alternative 1: Backend-Injected State
- Backend includes rate limit state in response body
- **Cons**: Requires backend changes, duplicates Retry-After header
- **Decision**: Use existing Retry-After header — no backend changes needed

### Alternative 2: WebSocket-Based Rate Limit Updates
- Real-time rate limit status via WebSocket
- **Cons**: Requires WebSocket infrastructure, overkill for this feature
- **Decision**: Use localStorage + countdown timer — simpler, no new infrastructure

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

**If no deferred improvements are found, write: "No deferred improvements found in previous tickets."**

**All items above must be presented to the user before ticket approval.**

---

## Specification Generation

If a small model (7B–34B) will execute this ticket, the information above should be distilled into `04_SPECIFICATION.md` — a file that specifies exact file paths, imports, function signatures, test expectations, and edge cases. The small model should not need to make any architecture decisions; those are encoded in the Specification.

- [ ] `04_SPECIFICATION.md` has been created with exact file operations for each file
- [ ] Test expectations are specific (not "test it works" but "returns error with retryAfter when 429 received")
- [ ] Edge cases are enumerated explicitly
- [ ] Imports and dependencies are listed per file
- [ ] **Pending scope items presented to user**: All deferred improvements from previous tickets have been listed above and presented to the user

---

*This design document guides implementation. The "Extend Existing Structure" section is the most important — it tells the agent exactly how to add to what already exists rather than creating new code from scratch.*
