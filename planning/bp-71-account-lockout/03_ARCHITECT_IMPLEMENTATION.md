# 03_ARCHITECT_IMPLEMENTATION.md — Account Lockout Implementation Plan

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend + Frontend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `04_SPECIFICATION.md`

---

## Implementation Phases

### Phase 1: Database Migration

1. Create migration file:
   - `backend/src/migrations/XXX_add_locked_until_to_users.sql`
   - `backend/src/migrations/XXX_add_locked_until_to_users_rollback.sql`

2. Migration SQL:
   ```sql
   -- Apply
   ALTER TABLE users ADD COLUMN locked_until TIMESTAMP WITHOUT TIME ZONE;

   -- Rollback
   ALTER TABLE users DROP COLUMN locked_until;
   ```

3. Find next migration number by listing `backend/src/migrations/` and finding highest number.

---

### Phase 2: Backend AuthService Lockout Logic

#### `backend/src/services/AuthService.js` (MODIFY)

**Add to login method** (after password verification fails):
```javascript
// After bcrypt.compare returns false:
const MAX_ATTEMPTS = 10;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// Increment attempts atomically
const result = await pool.query(
  `UPDATE users SET login_attempts = login_attempts + 1, locked_until = CASE
    WHEN login_attempts + 1 >= $2 THEN NOW() + INTERVAL '15 minutes'
    ELSE locked_until
   END
   WHERE id = $1 AND locked_until IS NULL OR locked_until < NOW()
   RETURNING login_attempts, locked_until`,
  [user.id, MAX_ATTEMPTS]
);

const updatedUser = result.rows[0];

if (updatedUser.login_attempts >= MAX_ATTEMPTS && updatedUser.locked_until) {
  throw new AppError('ACCOUNT_LOCKED', 423, `Account locked after ${MAX_ATTEMPTS} failed attempts`);
}

// If already locked, throw
if (user.locked_until && user.locked_until > new Date()) {
  throw new AppError('ACCOUNT_LOCKED', 423, `Account locked until ${user.locked_until.toISOString()}`);
}
```

**Add to login method** (after successful password verification):
```javascript
// Reset attempts on success
await pool.query(
  `UPDATE users SET login_attempts = 0, locked_until = NULL WHERE id = $1`,
  [user.id]
);
```

#### `backend/src/controllers/authController.js` (MODIFY)

**Add 423 handling** in login handler:
```javascript
try {
  // existing login logic
} catch (error) {
  if (error.code === 'ACCOUNT_LOCKED') {
    const retryAfter = Math.ceil((error.lockedUntil - Date.now()) / 1000);
    return res.status(423).json({
      success: false,
      error: {
        code: 'ACCOUNT_LOCKED',
        message: `Account locked. Try again in ${Math.floor(retryAfter / 60)}m ${retryAfter % 60}s.`,
        lockedUntil: error.lockedUntil,
        retryAfter
      }
    });
  }
  next(error);
}
```

---

### Phase 3: Admin Unlock Endpoint

#### `backend/src/controllers/adminController.js` (CREATE or MODIFY)

**Add unlockUser method**:
```javascript
async unlockUser(req, res, next) {
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

#### `backend/src/api/v1/index.js` (MODIFY)

**Add route**:
```javascript
router.post('/admin/users/:id/unlock', requireSuperAdmin, adminController.unlockUser);
```

---

### Phase 4: Frontend Lockout UI

#### `frontend/src/views/Login.vue` (MODIFY)

**Add lockout state**:
```typescript
const lockoutActive = ref(false);
const lockedUntil = ref<string | null>(null);
const countdownSeconds = ref(0);

// In login error handler:
if (error?.response?.data?.error?.code === 'ACCOUNT_LOCKED') {
  lockoutActive.value = true;
  lockedUntil.value = error.response.data.error.lockedUntil;
  startCountdown();
}

// Countdown function:
function startCountdown() {
  const update = () => {
    if (!lockedUntil.value) {
      lockoutActive.value = false;
      return;
    }
    const remaining = Math.ceil((new Date(lockedUntil.value).getTime() - Date.now()) / 1000);
    if (remaining <= 0) {
      lockoutActive.value = false;
      return;
    }
    countdownSeconds.value = remaining;
    setTimeout(update, 1000);
  };
  update();
}
```

**Add lockout banner template**:
```vue
<div v-if="lockoutActive" class="lockout-banner">
  <svg class="lockout-icon"><!-- AlertIcon --></svg>
  <span>Account locked. Try again in {{ Math.floor(countdownSeconds / 60) }}m {{ countdownSeconds % 60 }}s.</span>
</div>
```

**Add scoped CSS**:
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
```

#### `frontend/src/api/auth.js` (MODIFY)

**Handle 423 in login**:
```typescript
async function login(email: string, password: string) {
  try {
    const response = await post('/auth/login', { email, password });
    return response.data;
  } catch (error: any) {
    if (error.response?.status === 423) {
      // Return lockout info for frontend to display
      return { success: false, lockout: error.response.data.error };
    }
    throw error;
  }
}
```

---

### Phase 5: Tests

#### CREATE: `backend/src/__tests__/authLockout.test.js`
```javascript
const AuthService = require('services/AuthService');
const { pool } = require('db');

describe('AuthService - Account Lockout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('increments login_attempts on failed password', async () => {
    // Stub pool.query to simulate failed password
    // Assert login_attempts incremented
  });

  it('sets locked_until after 10 failed attempts', async () => {
    // Simulate 10 failed attempts
    // Assert locked_until is set
  });

  it('throws 423 when account is locked', async () => {
    // Stub user with locked_until in future
    // Assert AppError with code ACCOUNT_LOCKED and status 423
  });

  it('resets login_attempts on successful login', async () => {
    // Stub successful password
    // Assert pool.query called with SET login_attempts = 0
  });

  it('allows login after lockout expires', async () => {
    // Stub user with locked_until in past
    // Assert login proceeds normally
  });
});
```

#### CREATE: `backend/src/__tests__/authLockoutApi.test.js`
```javascript
const request = require('supertest');
const app = require('src/index');

describe('POST /api/auth/login - Lockout', () => {
  it('returns 423 when account is locked', async () => {
    // Register user, attempt 10 failed logins
    // Assert 423 response with ACCOUNT_LOCKED code
  });

  it('includes retryAfter in 423 response', async () => {
    // Assert response has retryAfter field (seconds)
  });
});
```

#### CREATE: `backend/integration-test/suites/auth-lockout.test.sh`
```bash
#!/bin/bash
# Test account lockout flow

# 1. Register new user
# 2. Attempt 10 failed logins
# 3. Verify 423 response
# 4. Verify lockedUntil is in the future
# 5. Manually unlock via admin API
# 6. Verify successful login after unlock
```

#### CREATE: `frontend/src/__tests__/loginLockout.test.ts`
```typescript
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import Login from '@/views/Login.vue';

describe('Login.vue - Lockout', () => {
  it('shows lockout banner when locked', async () => {
    // Mock login API to return 423
    // Mount component
    // Assert lockout banner is visible
  });

  it('disables form during lockout', async () => {
    // Mock login API to return 423
    // Mount component
    // Assert submit button is disabled
  });

  it('updates countdown every second', async () => {
    // Mock login API to return 423 with lockedUntil 60s away
    // Mount component
    // Wait 2s
    // Assert countdown decreased by 2
  });

  it('re-enables form when countdown reaches 0', async () => {
    // Mock lockedUntil to be 1s in the future
    // Mount component
    // Wait for countdown
    // Assert form is re-enabled
  });
});
```

---

### Phase 6: OpenAPI Spec & Generated Types

1. Add JSDoc annotations to login route (423 response)
2. Add JSDoc annotations to unlock route
3. Run `cd backend && npm run generate:spec`
4. Run `cd frontend && npm run generate:api`
5. Run `cd frontend && npm run typecheck`

---

## Files Changed

```
backend/src/migrations/XXX_add_locked_until_to_users.sql        → CREATE
backend/src/migrations/XXX_add_locked_until_to_users_rollback.sql → CREATE
backend/src/services/AuthService.js                              → MODIFY (lockout logic)
backend/src/controllers/authController.js                        → MODIFY (423 handling)
backend/src/controllers/adminController.js                       → MODIFY (unlockUser)
backend/src/api/v1/index.js                                      → MODIFY (unlock route)
backend/src/validators/auth.js                                   → MODIFY (add lockout schema)
frontend/src/views/Login.vue                                     → MODIFY (lockout UI)
frontend/src/api/auth.js                                         → MODIFY (423 handling)
backend/src/__tests__/authLockout.test.js                        → CREATE
backend/src/__tests__/authLockoutApi.test.js                     → CREATE
backend/integration-test/suites/auth-lockout.test.sh             → CREATE
frontend/src/__tests__/loginLockout.test.ts                      → CREATE
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
| 1 | bp-01-rate-limit-auth | Rate limit countdown UI (show remaining time on frontend) | UX | bp-72-rate-limit-ui | ☐ |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting | ☐ |
| 3 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation | ☐ |
| 4 | bp-07-structured-logging | Log file rotation (winston-daily-rotate-file) | Observability | bp-75-log-rotation | ☐ |

**If no deferred improvements are found, write: "No deferred improvements found in previous tickets."**

**All items above must be presented to the user before ticket approval.**

---

### i) Code Review Checklist

- [ ] Backend follows existing patterns (controller/service/model separation)
- [ ] Backend uses parameterized queries (no SQL injection)
- [ ] Backend has JSDoc OpenAPI annotations
- [ ] Backend response format: `{ success: true, data: { ... } }`
- [ ] Backend errors pass to `next(error)`
- [ ] Frontend API client uses existing `get`, `post`, `put`, `del`, `patch` from `./client`
- [ ] Frontend API client handles errors with `.catch()`
- [ ] Frontend UI follows existing patterns (CSS classes, component structure)
- [ ] Frontend UI handles loading, error, and empty states
- [ ] Frontend UI extends existing code rather than creating new (when possible)
- [ ] Frontend types match backend response shapes
- [ ] All tests written and passing — new/changed code has corresponding test files CREATED or EXTENDED
- [ ] OpenAPI spec regenerated if backend routes changed
- [ ] Generated TypeScript types regenerated if response shapes changed
- [ ] Generated types compile: `npm run typecheck`
- [ ] Response validation updated: `frontend/src/api/validator.ts` matches backend changes
- [ ] Contract test updated: `frontend/src/__tests__/api-contract.test.ts` covers any new/changed fields
- [ ] Bash integration suite test added or extended for API changes
- [ ] **Coverage threshold enforced**: `npm run test:coverage` (backend) or `npm test -- --run --coverage` (frontend) — min 60% lines, functions, branches, statements
- [ ] Specification in `04_SPECIFICATION.md` matches what was actually implemented
- [ ] **Pending scope items presented to user**: All deferred improvements from previous tickets have been listed above and presented to the user

---

### j) Post-Deploy Verification

1. [ ] Backend: `npm test` passes
2. [ ] Backend: `npm run test:integration` passes (if applicable)
3. [ ] **Backend: `cd backend && bash integration-test/run.sh --only` passes (if backend API changed)**
4. [ ] Backend: `npm run lint` passes
5. [ ] **Backend: `npm run test:coverage` passes (60% min threshold)**
6. [ ] Frontend: `npm run lint` passes
7. [ ] Frontend: `npm run typecheck` passes
8. [ ] Frontend: `npm run build` passes
9. [ ] Frontend: `npm test -- --run --coverage` passes (60% min threshold)
10. [ ] API endpoint responds correctly: `curl http://localhost:3001/api/auth/login`
11. [ ] Frontend UI loads correctly in browser
12. [ ] Auth/permissions work correctly
13. [ ] Error cases handled gracefully
14. [ ] If specification file exists: implementation matches the spec

---

*Fill in all sections before starting implementation. Update status as work progresses. The "Files Changed" section is the most important — it prevents agents from creating redundant code by forcing them to check what already exists.*
