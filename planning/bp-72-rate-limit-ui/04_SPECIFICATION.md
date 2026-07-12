# 04_SPECIFICATION.md — Rate Limit Countdown UI Execution Spec

**Use this file when a small model (7B–34B) will execute the ticket.**  
This file bridges the planning docs (01–03) and the code. It specifies exact file operations, imports, function signatures, test expectations, and edge cases. The model should not need to make any architecture decisions — those are already encoded here.

**Generated from**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`
**Target model**: 34B local model
**Date**: 2025-07-12

---

## Test-First Requirement

**Test stub files MUST be created before any production code.** This prevents the model from skipping tests.

The model MUST:
1. Create **empty test stub files** (with imports, `describe` blocks, and stub `it` blocks) for every test file listed in "Test Expectations" below
2. Create **production code files** (implementation + components)
3. Fill in the test stubs with actual assertions

Only after all test stubs exist as empty files may the model begin implementing production code. Do not defer test creation to a later step.

---

## File Operations

Each entry specifies exactly what the model should produce. The model MUST NOT create, modify, or delete any file not listed here.

### MODIFY: `frontend/src/api/client.js`

**Add type interface** (add near top of file with other types):

```typescript
interface RateLimitInfo {
  retryAfter: number;
  retryAt: string;
}

interface RateLimitError {
  success: false;
  error: {
    code: 'RATE_LIMITED';
    message: string;
    retryAfter: number;
    retryAt: string;
  };
}
```

**Modify the fetch wrapper** to extract Retry-After header on 429:

```typescript
// In the response handler (after fetch call, before return):
const rateLimitInfo = extractRateLimitInfo(response);
if (rateLimitInfo) {
  // Store in localStorage for persistence
  localStorage.setItem('rateLimitActive', 'true');
  localStorage.setItem('rateLimitRetryAt', rateLimitInfo.retryAt);
}

// Add helper function near other helpers:
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

**Modify the error handler** to handle 429:

```typescript
// In the catch block of the fetch wrapper, BEFORE the generic error throw:
} catch (error: any) {
  if (error.response?.status === 429) {
    const retryAfterHeader = error.response.headers?.get('Retry-After') || '60';
    const retryAfter = parseInt(retryAfterHeader, 10);
    const rateLimitError: RateLimitError = {
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: `Too many requests. Please try again in ${retryAfter} seconds.`,
        retryAfter,
        retryAt: new Date(Date.now() + retryAfter * 1000).toISOString()
      }
    };
    localStorage.setItem('rateLimitActive', 'true');
    localStorage.setItem('rateLimitRetryAt', rateLimitError.error.retryAt);
    throw rateLimitError;
  }
  // ... existing error handling ...
}
```

---

### CREATE: `frontend/src/stores/rateLimit.ts`

**Full file contents**:

```typescript
import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useRateLimitStore = defineStore('rateLimit', () => {
  const rateLimitActive = ref(false);
  const retryAt = ref<string | null>(null);
  const countdownSeconds = ref(0);
  let countdownTimer: ReturnType<typeof setTimeout> | null = null;

  function clearCountdown() {
    if (countdownTimer) {
      clearTimeout(countdownTimer);
      countdownTimer = null;
    }
  }

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

### MODIFY: `frontend/src/views/Login.vue`

**Add imports**:

```typescript
import { useRateLimitStore } from '@/stores/rateLimit';
```

**Add store initialization** in `<script setup>`:

```typescript
const rateLimitStore = useRateLimitStore();
```

**Add onMounted hook** (add to existing composables or create new):

```typescript
import { onMounted } from 'vue';

onMounted(() => {
  rateLimitStore.restoreFromStorage();
});
```

**Modify login error handler** to handle rate limit:

```typescript
// In handleLogin(), in the catch block, BEFORE existing error handling:
} catch (error: any) {
  if (error?.error?.code === 'RATE_LIMITED') {
    rateLimitStore.setRateLimit(error.error.retryAfter);
    return;
  }
  // ... existing error handling ...
}
```

**Add template** (before the `<form>` element):

```vue
<div v-if="rateLimitStore.rateLimitActive" class="rate-limit-banner">
  <svg class="rate-limit-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="12" cy="12" r="10"/>
    <polyline points="12 6 12 12 16 14"/>
  </svg>
  <span>Too many requests. Try again in {{ Math.floor(rateLimitStore.countdownSeconds / 60) }}m {{ rateLimitStore.countdownSeconds % 60 }}s.</span>
</div>
```

**Add CSS** in `<style scoped>`:

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

### MODIFY: `frontend/src/views/Register.vue` (if exists)

**Same pattern as Login.vue** — add `useRateLimitStore()`, rate limit banner template, and CSS. Check if Register.vue exists first; if not, skip this file.

---

### CREATE: `frontend/src/__tests__/rateLimitClient.test.ts`

**Full file contents**:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get, post, put, del, patch } from '@/api/client';

describe('API client - Rate limit handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('extracts Retry-After header from 429 response', async () => {
    // TODO: implement
  });

  it('returns rate limit info in error object', async () => {
    // TODO: implement
  });

  it('stores rate limit state in localStorage', async () => {
    // TODO: implement
  });
});
```

---

### CREATE: `frontend/src/__tests__/rateLimitUi.test.ts`

**Full file contents**:

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
    // TODO: implement
  });

  it('disables form during rate limit', async () => {
    // TODO: implement
  });

  it('updates countdown every second', async () => {
    // TODO: implement
  });

  it('re-enables form when countdown reaches 0', async () => {
    // TODO: implement
  });

  it('persists rate limit state across page refresh', async () => {
    // TODO: implement
  });
});
```

---

### CREATE: `frontend/cypress/component/RateLimitBanner.cy.ts`

**Full file contents**:

```typescript
describe('RateLimitBanner component', () => {
  it('displays countdown in Xm Ys format', () => {
    // TODO: implement
  });

  it('hides when rate limit expires', () => {
    // TODO: implement
  });
});
```

---

## Test Expectations

List every test case the model must create, organized by layer. Do not write "test it works" — each case must describe a specific input, expected output, and why it matters.

### Frontend Unit Tests — API Client Rate Limit
```
✓ [happy] API client extracts Retry-After header from 429 response
✓ [error] API client returns error with code 'RATE_LIMITED'
✓ [error] API client error includes retryAfter (number) and retryAt (ISO string)
✓ [edge] API client stores rate limit state in localStorage
✓ [edge] API client defaults to 60 seconds when Retry-After header is missing
```

### Frontend Unit Tests — Login.vue Rate Limit UI
```
✓ [ui] Login shows rate limit banner when API returns RATE_LIMITED
✓ [ui] Login disables submit button during rate limit
✓ [ui] Login shows countdown in "Xm Ys" format
✓ [ui] Login re-enables form when countdown reaches 0
✓ [ui] Login restores rate limit state from localStorage on mount
✓ [edge] Login handles countdown reaching 0 (clears rate limit state)
```

### Frontend Contract Tests
```
✓ [shape] Rate limit error has { code: 'RATE_LIMITED', message, retryAfter, retryAt }
✓ [error] Rate limit error uses { success: false, error: { ... } } format
```

---

## Edge Cases to Handle

1. **[Retry-After header missing]**: Backend doesn't send Retry-After — Handle: Default to 60 seconds
2. **[Rate limit during countdown]**: User hits rate limit again while already rate limited — Handle: Reset countdown to new Retry-After value
3. **[Page refresh during rate limit]**: User refreshes page — Handle: Restore state from localStorage
4. **[Clock skew]**: Client clock differs from server — Handle: Use server's retryAt timestamp, not client-relative countdown

---

## Existing Code Patterns to Follow

- Frontend API client uses native `fetch` — **not axios**
- Frontend stores use Pinia (`defineStore`)
- Frontend uses `<script setup>` syntax, not Options API
- Frontend imports from `@/stores/` not relative paths
- Frontend error messages in English, no i18n wrappers
- Frontend CSS in `<style scoped>` blocks
- Tests use Vitest (`describe`, `it`, `expect`, `vi`)
- Countdown uses absolute time (retryAt), not relative counter

---

## Pending Scope Items

**All deferred improvements from previous tickets' "Out of Scope" sections that are relevant to this ticket have been presented to the user in the 01/02/03 documents above.**

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-76-email-notifications | ☐ |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting | ☐ |
| 3 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation | ☐ |
| 4 | bp-07-structured-logging | Log file rotation (winston-daily-rotate-file) | Observability | bp-75-log-rotation | ☐ |

**If no deferred improvements are found, write: "No deferred improvements found in previous tickets."**

---

## Files NOT to Change

- `backend/src/middleware/rateLimiter.js` — backend already sends Retry-After header, no changes needed
- `frontend/src/router/index.ts` — no route changes needed
- `frontend/src/stores/auth.js` — rate limit state is in new rateLimit store, not auth store
- `frontend/src/api/generated/` — no generated types needed (429 response shape unchanged)

---

*This specification is the contract between planning and execution. If the model cannot produce code matching this spec, it should request human feedback rather than guessing.*
