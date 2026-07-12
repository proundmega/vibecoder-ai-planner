# 04_SPECIFICATION.md — Account Lockout Execution Spec

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

### CREATE: `backend/src/migrations/XXX_add_locked_until_to_users.sql`

**Contents**:
```sql
ALTER TABLE users ADD COLUMN locked_until TIMESTAMP WITHOUT TIME ZONE;
```

### CREATE: `backend/src/migrations/XXX_add_locked_until_to_users_rollback.sql`

**Contents**:
```sql
ALTER TABLE users DROP COLUMN locked_until;
```

**Note**: Replace `XXX` with the next available migration number. List `backend/src/migrations/` to find the highest number.

### MODIFY: `backend/src/services/AuthService.js`

**Add method/function**:
```javascript
// In login() method, after password verification fails:
async function login(email, password) {
  // ... existing code to find user ...
  
  const passwordValid = await bcrypt.compare(password, user.password_hash);
  
  if (!passwordValid) {
    // ADD: Increment attempts and check lockout
    const MAX_ATTEMPTS = 10;
    const result = await pool.query(
      `UPDATE users SET login_attempts = login_attempts + 1, locked_until = CASE
        WHEN login_attempts + 1 >= $2 THEN NOW() + INTERVAL '15 minutes'
        ELSE locked_until
       END
       WHERE id = $1 AND (locked_until IS NULL OR locked_until < NOW())
       RETURNING login_attempts, locked_until`,
      [user.id, MAX_ATTEMPTS]
    );
    
    const updated = result.rows[0];
    if (updated.login_attempts >= MAX_ATTEMPTS && updated.locked_until) {
      throw new AppError('ACCOUNT_LOCKED', 423, `Account locked after ${MAX_ATTEMPTS} failed attempts`, updated.locked_until);
    }
    
    throw new AppError('INVALID_CREDENTIALS', 401, 'Invalid email or password');
  }
  
  // ADD: Reset attempts on success
  await pool.query(
    `UPDATE users SET login_attempts = 0, locked_until = NULL WHERE id = $1`,
    [user.id]
  );
  
  // ... rest of existing success code ...
}
```

**Position in file**: Inside existing `login()` method, after `bcrypt.compare` check

### MODIFY: `backend/src/controllers/authController.js`

**Add method/function**:
```javascript
// In login handler, add 423 handling:
async function login(req, res, next) {
  try {
    const result = await AuthService.login(req.body.email, req.body.password);
    res.json({ success: true, data: result });
  } catch (error) {
    if (error.code === 'ACCOUNT_LOCKED') {
      const retryAfter = Math.ceil((error.lockedUntil.getTime() - Date.now()) / 1000);
      return res.status(423).json({
        success: false,
        error: {
          code: 'ACCOUNT_LOCKED',
          message: `Account locked. Try again in ${Math.floor(retryAfter / 60)}m ${retryAfter % 60}s.`,
          lockedUntil: error.lockedUntil,
          retryAfter: Math.max(0, retryAfter)
        }
      });
    }
    next(error);
  }
}
```

**Position in file**: Inside existing `login` controller function, in the catch block

### MODIFY: `backend/src/controllers/adminController.js`

**Add method/function**:
```javascript
async function unlockUser(req, res, next) {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE users SET login_attempts = 0, locked_until = NULL WHERE id = $1 RETURNING id, email, login_attempts, locked_until`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
}
```

**Position in file**: Add as new method in adminController.js

**Imports to add**:
```javascript
const { pool } = require('../db');
```

### MODIFY: `backend/src/api/v1/index.js`

**Add route**:
```javascript
// After existing admin routes, add:
router.post('/admin/users/:id/unlock', requireSuperAdmin, adminController.unlockUser);
```

**Position in file**: In the admin routes section, after other admin user routes

### MODIFY: `frontend/src/views/Login.vue`

**Add state variables**:
```typescript
const lockoutActive = ref(false);
const lockedUntil = ref<string | null>(null);
const countdownSeconds = ref(0);
```

**Add function**:
```typescript
function startCountdown() {
  const update = () => {
    if (!lockedUntil.value) {
      lockoutActive.value = false;
      return;
    }
    const remaining = Math.ceil((new Date(lockedUntil.value).getTime() - Date.now()) / 1000);
    if (remaining <= 0) {
      lockoutActive.value = false;
      countdownSeconds.value = 0;
      return;
    }
    countdownSeconds.value = remaining;
    setTimeout(update, 1000);
  };
  update();
}
```

**Add template** (before the form):
```vue
<div v-if="lockoutActive" class="lockout-banner">
  <svg class="lockout-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
  <span>Account locked. Try again in {{ Math.floor(countdownSeconds / 60) }}m {{ countdownSeconds % 60 }}s.</span>
</div>
```

**Modify login handler** to handle lockout:
```typescript
// In handleLogin(), in the catch block:
} catch (error: any) {
  if (error?.response?.data?.error?.code === 'ACCOUNT_LOCKED') {
    lockoutActive.value = true;
    lockedUntil.value = error.response.data.error.lockedUntil;
    startCountdown();
    return;
  }
  // ... existing error handling ...
}
```

**Add CSS** in scoped style:
```css
.lockout-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  margin-bottom: 1rem;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 0.5rem;
  color: #991b1b;
  font-size: 0.875rem;
}

.lockout-icon {
  flex-shrink: 0;
}
```

### MODIFY: `frontend/src/api/auth.js`

**Add to login function**:
```typescript
// In login() function's catch block:
} catch (error: any) {
  if (error.response?.status === 423) {
    return { success: false, lockout: error.response.data.error };
  }
  throw error;
}
```

### CREATE: `backend/src/__tests__/authLockout.test.js`

**Imports**:
```javascript
const { pool } = require('../db');
const AppError = require('../utils/AppError');

// Mock pool
jest.mock('../db', () => ({
  pool: { query: jest.fn() }
}));
```

**Test stubs**:
```javascript
describe('AuthService - Account Lockout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('increments login_attempts on failed password', async () => {
    // TODO: implement
  });

  it('sets locked_until after 10 failed attempts', async () => {
    // TODO: implement
  });

  it('throws 423 when account is locked', async () => {
    // TODO: implement
  });

  it('resets login_attempts on successful login', async () => {
    // TODO: implement
  });

  it('allows login after lockout expires', async () => {
    // TODO: implement
  });
});
```

### CREATE: `backend/src/__tests__/authLockoutApi.test.js`

**Imports**:
```javascript
const request = require('supertest');
// Import app from src/index.js (skips listen in test mode)
```

**Test stubs**:
```javascript
describe('POST /api/auth/login - Lockout', () => {
  it('returns 423 when account is locked', async () => {
    // TODO: implement
  });

  it('includes retryAfter in 423 response', async () => {
    // TODO: implement
  });
});
```

### CREATE: `backend/integration-test/suites/auth-lockout.test.sh`

**Contents**:
```bash
#!/bin/bash
set -e

# Test account lockout flow
# Requires: Docker containers running, real PG

BASE_URL="${BASE_URL:-http://localhost:3001}"

echo "=== Account Lockout Integration Test ==="

# 1. Register a new user
echo "1. Registering new user..."
REGISTER_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"email":"lockout-test@example.com","password":"wrongpassword123","name":"Lockout Test"}')
echo "$REGISTER_RESPONSE"

# 2. Get user ID from registration
USER_ID=$(echo "$REGISTER_RESPONSE" | jq -r '.data.user.id')
echo "User ID: $USER_ID"

# 3. Attempt 10 failed logins
echo "2. Attempting 10 failed logins..."
for i in {1..10}; do
  curl -s -X POST "$BASE_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"lockout-test@example.com","password":"wrongpassword"}' > /dev/null
done

# 4. 11th attempt should return 423
echo "3. Checking 423 response on 11th attempt..."
LOCKOUT_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"lockout-test@example.com","password":"wrongpassword"}')
LOCKOUT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"lockout-test@example.com","password":"wrongpassword"}')

if [ "$LOCKOUT_STATUS" != "423" ]; then
  echo "FAIL: Expected 423, got $LOCKOUT_STATUS"
  exit 1
fi

LOCKOUT_CODE=$(echo "$LOCKOUT_RESPONSE" | jq -r '.error.code')
if [ "$LOCKOUT_CODE" != "ACCOUNT_LOCKED" ]; then
  echo "FAIL: Expected ACCOUNT_LOCKED, got $LOCKOUT_CODE"
  exit 1
fi

echo "PASS: Account locked with 423 response"

# 5. Manually unlock via admin API
echo "4. Unlocking account via admin API..."
# Note: Requires admin token - use test setup
# ADMIN_UNLOCK=$(curl -s -X POST "$BASE_URL/api/v1/admin/users/$USER_ID/unlock" \
#   -H "Authorization: Bearer $ADMIN_TOKEN")

echo "PASS: Account lockout integration test complete"
```

### CREATE: `frontend/src/__tests__/loginLockout.test.ts`

**Imports**:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import Login from '@/views/Login.vue';
import * as authApi from '@/api/auth';
```

**Test stubs**:
```typescript
describe('Login.vue - Lockout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows lockout banner when locked', async () => {
    // TODO: implement
  });

  it('disables form during lockout', async () => {
    // TODO: implement
  });

  it('updates countdown every second', async () => {
    // TODO: implement
  });

  it('re-enables form when countdown reaches 0', async () => {
    // TODO: implement
  });
});
```

---

## Test Expectations

List every test case the model must create, organized by layer. Do not write "test it works" — each case must describe a specific input, expected output, and why it matters.

### Backend Unit Tests — AuthService Lockout
```
✓ [happy] login with valid credentials resets login_attempts to 0
✓ [error] login with wrong password increments login_attempts by 1
✓ [error] login increments login_attempts up to 10
✓ [edge] login sets locked_until when login_attempts reaches 10
✓ [error] login throws ACCOUNT_LOCKED (423) when locked_until is in the future
✓ [edge] login proceeds when locked_until is in the past (auto-unlock)
```

### Backend Bash Integration Tests
```
✓ [happy] POST /api/auth/login returns 423 after 10 failed attempts
✓ [error] 423 response includes error.code = 'ACCOUNT_LOCKED'
✓ [error] 423 response includes retryAfter (seconds)
✓ [flow] admin unlock endpoint resets login_attempts and locked_until
```

### Frontend Unit Tests — Login.vue Lockout
```
✓ [ui] Login shows lockout banner when API returns ACCOUNT_LOCKED
✓ [ui] Login disables submit button during lockout
✓ [ui] Login shows countdown in "Xm Ys" format
✓ [ui] Login re-enables form when countdown reaches 0
```

### Frontend Contract Tests
```
✓ [shape] Lockout error response has { code, message, lockedUntil, retryAfter }
✓ [error] Lockout error uses { error: { code, message } } format
```

---

## Edge Cases to Handle

1. **[Race condition]**: Concurrent login attempts — Use atomic UPDATE with WHERE clause to prevent incrementing past 10
2. **[Timezone]**: locked_until is TIMESTAMP WITHOUT TIME ZONE — Store in UTC, display in user's local time on frontend
3. **[Page refresh]**: User refreshes page during lockout — Check lockout state on mount, fetch current lockout status from API
4. **[Password reset during lockout]**: Allow password reset even when locked (different flow, not affected by lockout)
5. **[Clock skew]**: Database clock differs from application server — Use database time for locked_until comparisons

---

## Existing Code Patterns to Follow

- Use `pool.query()` with parameterized queries (no SQL injection)
- Error format: `{ success: false, error: { code, message } }`
- Frontend: `<script setup>` syntax, not Options API
- Frontend: Import from `@/stores/` not relative paths
- Frontend: Error messages in English, no i18n wrappers
- Backend: JSDoc annotations for OpenAPI spec generation
- Tests: Use `jest.mock()` for database dependencies in unit tests

---

## Pending Scope Items

**All deferred improvements from previous tickets' "Out of Scope" sections that are relevant to this ticket have been presented to the user in the 01/02/03 documents above.**

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-01-rate-limit-auth | Rate limit countdown UI (show remaining time on frontend) | UX | bp-72-rate-limit-ui | ☐ |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting | ☐ |
| 3 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation | ☐ |
| 4 | bp-07-structured-logging | Log file rotation (winston-daily-rotate-file) | Observability | bp-75-log-rotation | ☐ |

**If no deferred improvements are found, write: "No deferred improvements found in previous tickets."**

---

## Files NOT to Change

- `backend/src/middleware/authMiddleware.js` — existing auth middleware, lockout handled in controller
- `frontend/src/router/index.ts` — no route changes needed
- `frontend/src/stores/auth.js` — lockout state is component-local, not in Pinia store
- `backend/src/models/User.js` — no model changes needed, lockout is in AuthService

---

*This specification is the contract between planning and execution. If the model cannot produce code matching this spec, it should request human feedback rather than guessing.*
