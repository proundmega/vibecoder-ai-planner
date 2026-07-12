# 03_ARCHITECT_IMPLEMENTATION.md — Rate Limit Countdown UI Implementation Plan

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Frontend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `04_SPECIFICATION.md`

---

## Implementation Phases

### Phase 1: API Client — Retry-After Extraction

#### `frontend/src/api/client.js` (MODIFY)

**Add Retry-After extraction** in the response handler:

```typescript
// In the response transformation logic:
function extractRateLimitInfo(response: Response): RateLimitInfo | null {
  const retryAfter = response.headers.get('Retry-After');
  if (retryAfter && response.status === 429) {
    return {
      retryAfter: parseInt(retryAfter, 10),
      retryAt: new Date(Date.now() + parseInt(retryAfter, 10) * 1000).toISOString()
    };
  }
  return null;
}
```

**Add to error handling**:

```typescript
// In the error handler of the fetch wrapper:
} catch (error: any) {
  if (error.response?.status === 429) {
    const retryAfter = parseInt(error.response.headers?.get('Retry-After') || '60', 10);
    const rateLimitInfo: RateLimitInfo = {
      retryAfter,
      retryAt: new Date(Date.now() + retryAfter * 1000).toISOString()
    };
    const rateLimitError: RateLimitError = {
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: `Too many requests. Please try again in ${retryAfter} seconds.`,
        retryAfter,
        retryAt: rateLimitInfo.retryAt
      }
    };
    // Store in localStorage for persistence
    localStorage.setItem('rateLimitActive', 'true');
    localStorage.setItem('rateLimitRetryAt', rateLimitInfo.retryAt);
    throw rateLimitError;
  }
  throw error;
}
```

---

### Phase 2: Rate Limit Store

#### CREATE: `frontend/src/stores/rateLimit.ts`

```typescript
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

export const useRateLimitStore = defineStore('rateLimit', () => {
  const rateLimitActive = ref(false);
  const retryAt = ref<string | null>(null);
  const countdownSeconds = ref(0);
  let countdownTimer: ReturnType<typeof setTimeout> | null = null;

  function setRateLimit(retryAfter: number) {
    clearCountdown();
    rateLimitActive.value = true;
    retryAt.value = new Date(Date.now() + retryAfter * 1000).toISOString();
    countdownSeconds.value = retryAfter;
    localStorage.setItem('rateLimitActive', 'true');
    localStorage.setItem('rateLimitRetryAt', retryAt.value!);
    startCountdown();
  }

  function clearRateLimit() {
    clearCountdown();
    rateLimitActive.value = false;
    retryAt.value = null;
    countdownSeconds.value = 0;
    localStorage.removeItem('rateLimitActive');
    localStorage.removeItem('rateLimitRetryAt');
  }

  function startCountdown() {
    const update = () => {
      if (!retryAt.value) {
        clearRateLimit();
        return;
      }
      const remaining = Math.ceil(
        (new Date(retryAt.value).getTime() - Date.now()) / 1000
      );
      if (remaining <= 0) {
        clearRateLimit();
        return;
      }
      countdownSeconds.value = remaining;
      countdownTimer = setTimeout(update, 1000);
    };
    update();
  }

  function clearCountdown() {
    if (countdownTimer) {
      clearTimeout(countdownTimer);
      countdownTimer = null;
    }
  }

  function restoreFromStorage() {
    const active = localStorage.getItem('rateLimitActive');
    const retryAtStored = localStorage.getItem('rateLimitRetryAt');
    if (active === 'true' && retryAtStored) {
      retryAt.value = retryAtStored;
      rateLimitActive.value = true;
      const remaining = Math.ceil(
        (new Date(retryAtStored).getTime() - Date.now()) / 1000
      );
      if (remaining > 0) {
        countdownSeconds.value = remaining;
        startCountdown();
      } else {
        clearRateLimit();
      }
    }
  }

  // Restore on store initialization
  restoreFromStorage();

  return {
    rateLimitActive,
    retryAt,
    countdownSeconds,
    setRateLimit,
    clearRateLimit
  };
});
```

---

### Phase 3: Login.vue Rate Limit UI

#### `frontend/src/views/Login.vue` (MODIFY)

**Add rate limit state**:

```typescript
const rateLimitStore = useRateLimitStore();

// In onMounted:
onMounted(() => {
  rateLimitStore.restoreFromStorage();
});

// In login error handler:
} catch (error: any) {
  if (error?.error?.code === 'RATE_LIMITED') {
    rateLimitStore.setRateLimit(error.error.retryAfter);
    return;
  }
  // ... existing error handling ...
}
```

**Add template** (before the form):

```vue
<div v-if="rateLimitStore.rateLimitActive" class="rate-limit-banner">
  <svg class="rate-limit-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="12" cy="12" r="10"/>
    <polyline points="12 6 12 12 16 14"/>
  </svg>
  <span>Too many requests. Try again in {{ Math.floor(rateLimitStore.countdownSeconds / 60) }}m {{ rateLimitStore.countdownSeconds % 60 }}s.</span>
</div>
```

**Add CSS** in scoped style:

```css
.rate-limit-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  margin-bottom: 1rem;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 0.5rem;
  color: #92400e;
  font-size: 0.875rem;
}

.rate-limit-icon {
  flex-shrink: 0;
}
```

---

### Phase 4: Register.vue Rate Limit UI (if exists)

#### `frontend/src/views/Register.vue` (MODIFY)

**Same pattern as Login.vue** — add rate limit banner, use `useRateLimitStore()`.

---

### Phase 5: Tests

#### CREATE: `frontend/src/__tests__/rateLimitClient.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get, post, put, del, patch } from '@/api/client';

describe('API client - Rate limit handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('extracts Retry-After header from 429 response', async () => {
    // Mock fetch returning 429 with Retry-After: 45
    // Assert error includes retryAfter: 45
  });

  it('returns rate limit info in error object', async () => {
    // Mock fetch returning 429
    // Assert error has { code: 'RATE_LIMITED', retryAfter, retryAt }
  });

  it('stores rate limit state in localStorage', async () => {
    // Mock fetch returning 429
    // Assert localStorage has rateLimitActive and rateLimitRetryAt
  });
});
```

#### CREATE: `frontend/src/__tests__/rateLimitUi.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import Login from '@/views/Login.vue';
import * as authApi from '@/api/auth';

describe('Login.vue - Rate limit UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

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

#### CREATE: `frontend/cypress/component/RateLimitBanner.cy.ts`

```typescript
describe('RateLimitBanner component', () => {
  it('displays countdown in Xm Ys format', () => {
    // Mount with rateLimitActive = true, countdownSeconds = 75
    // Assert text contains "1m 15s"
  });

  it('hides when rate limit expires', () => {
    // Mount with countdownSeconds = 0
    // Assert banner is not visible
  });
});
```

---

### Phase 6: Typecheck & Build

1. Run `cd frontend && npm run typecheck` — verify no type errors
2. Run `cd frontend && npm run build` — verify build passes
3. Run `cd frontend && npm test -- --run --coverage` — verify 60% coverage

---

## Files Changed

```
frontend/src/api/client.js                                          → MODIFY (Retry-After extraction)
frontend/src/stores/rateLimit.ts                                    → CREATE (rate limit store)
frontend/src/views/Login.vue                                        → MODIFY (rate limit banner)
frontend/src/views/Register.vue                                     → MODIFY (rate limit banner, if exists)
frontend/src/__tests__/rateLimitClient.test.ts                      → CREATE
frontend/src/__tests__/rateLimitUi.test.ts                          → CREATE
frontend/cypress/component/RateLimitBanner.cy.ts                    → CREATE
```

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

### i) Code Review Checklist

- [ ] Frontend API client uses existing `get`, `post`, `put`, `del`, `patch` from `./client`
- [ ] Frontend API client handles errors with `.catch()` or try/catch
- [ ] Frontend UI follows existing patterns (CSS classes, component structure)
- [ ] Frontend UI handles loading, error, and empty states
- [ ] Frontend UI extends existing code rather than creating new (when possible)
- [ ] Frontend types match backend response shapes
- [ ] Frontend uses `<script setup>` syntax
- [ ] Rate limit store uses Pinia (existing pattern)
- [ ] Rate limit state persists to localStorage
- [ ] Countdown uses absolute time (retryAt), not relative counter
- [ ] All tests written and passing — new/changed code has corresponding test files CREATED or EXTENDED
- [ ] Frontend `npm run typecheck` passes
- [ ] Frontend `npm run build` passes
- [ ] Frontend `npm test -- --run --coverage` passes (60% min threshold)
- [ ] **Coverage threshold enforced**: `npm test -- --run --coverage` — min 60% lines, functions, branches, statements
- [ ] Specification in `04_SPECIFICATION.md` matches what was actually implemented
- [ ] **Pending scope items presented to user**: All deferred improvements from previous tickets have been listed above and presented to the user

---

### j) Post-Deploy Verification

1. [ ] Frontend: `npm run lint` passes
2. [ ] Frontend: `npm run typecheck` passes
3. [ ] Frontend: `npm run build` passes
4. [ ] Frontend: `npm test -- --run --coverage` passes (60% min threshold)
5. [ ] Rate limit banner displays on 429 response
6. [ ] Countdown updates every second
7. [ ] Form is disabled during rate limit
8. [ ] Rate limit state persists across page refresh
9. [ ] Form re-enables when countdown reaches 0
10. [ ] If specification file exists: implementation matches the spec

---

*Fill in all sections before starting implementation. Update status as work progresses. The "Files Changed" section is the most important — it prevents agents from creating redundant code by forcing them to check what already exists.*
