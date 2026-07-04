# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Template

**Use this template for every ticket.** Copy this file into the ticket folder and fill in the sections.

---

## Ticket: bt-54 — Backfill Error Handling Tests

**Status**: planned | in_progress | completed | blocked
**Priority**: P1
**Effort**: Medium
**Author**: AI Assistant
**Date created**: 2026-07-04
**Date completed**: YYYY-MM-DD
**PR**: [link]
**Branch**: [branch-name]
**Scope**: Backend | Frontend

**Dependencies**: bp-54 (Error Handling) must be completed first

---

### a) Purpose

Backfill all missing test coverage for bp-54's error handling changes: `response.js` helpers, `AppError` class hierarchy with 10 error codes, zero `console.*` calls policy, `ErrorToast` component, `useAsyncState` composable, and auth flow regression.

---

### b) Actions

**CRITICAL**: This is a test-only ticket. Do NOT modify any production code.

#### Implementation Order

1. **Response helpers test** — `backend/src/__tests__/responseHelpers.test.js`
   - Test `sendSuccess` and `sendError` response shapes
   - *Depends on*: nothing

2. **AppError hierarchy test** — `backend/src/__tests__/appErrorHierarchy.test.js`
   - Test `AppError` class and all 10 error codes
   - *Depends on*: nothing

3. **No console calls test** — `backend/src/__tests__/noConsoleCalls.test.js`
   - Regex scan for `console.*` in production code
   - *Depends on*: nothing

4. **Auth flow regression test** — `backend/src/__tests__/integration/authFlowRegression.test.js`
   - Test login, register, token refresh
   - *Depends on*: nothing (uses real PG)

5. **useAsyncState composable test** — `frontend/src/__tests__/useAsyncState.test.ts`
   - Test loading/success/error states
   - *Depends on*: nothing

6. **ErrorToast component test** — `frontend/cypress/component/ErrorToast.spec.ts`
   - Test rendering and auto-dismiss
   - *Depends on*: nothing

---

### c) Per-File Action Plan

#### `backend/src/__tests__/responseHelpers.test.js` (CREATE)

```javascript
const { sendSuccess, sendError } = require('../../utils/response')
const { AppError, BadRequestError } = require('../../errors/HttpError')

describe('sendSuccess', () => {
  it('responds with { success: true, data, requestId }', () => {
    const res = { json: jest.fn() }
    sendSuccess(res, { foo: 'bar' }, 'req-123')
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { foo: 'bar' },
      requestId: 'req-123'
    })
  })

  it('omits requestId when not provided', () => {
    const res = { json: jest.fn() }
    sendSuccess(res, { foo: 'bar' })
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { foo: 'bar' }
    })
  })
})

describe('sendError', () => {
  it('responds with { success: false, error: { code, message } }', () => {
    const res = { json: jest.fn() }
    const err = new BadRequestError('missing field')
    sendError(res, err)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'missing field' }
    })
  })

  it('maps generic Error to INTERNAL', () => {
    const res = { json: jest.fn() }
    sendError(res, new Error('unexpected'))
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'INTERNAL', message: 'unexpected' }
    })
  })
})
```

#### `backend/src/__tests__/appErrorHierarchy.test.js` (CREATE)

```javascript
const {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  UnprocessableError,
  RateLimitedError,
  InternalError,
  ServiceUnavailableError,
  GoneError
} = require('../../errors/HttpError')

describe('AppError hierarchy', () => {
  it('AppError extends Error', () => {
    const err = new AppError('test', 500)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('AppError')
    expect(err.isAppError).toBe(true)
  })

  it('AppError has code, statusCode, and message', () => {
    const err = new AppError('test message', 500, 'TEST_CODE')
    expect(err.message).toBe('test message')
    expect(err.statusCode).toBe(500)
    expect(err.code).toBe('TEST_CODE')
  })
})

describe('Error code taxonomy (10 codes)', () => {
  it('BAD_REQUEST: status 400', () => {
    const err = new BadRequestError('bad')
    expect(err.statusCode).toBe(400)
    expect(err.code).toBe('BAD_REQUEST')
  })

  it('UNAUTHORIZED: status 401', () => {
    const err = new UnauthorizedError('unauth')
    expect(err.statusCode).toBe(401)
    expect(err.code).toBe('UNAUTHORIZED')
  })

  it('FORBIDDEN: status 403', () => {
    const err = new ForbiddenError('forbidden')
    expect(err.statusCode).toBe(403)
    expect(err.code).toBe('FORBIDDEN')
  })

  it('NOT_FOUND: status 404', () => {
    const err = new NotFoundError('not found')
    expect(err.statusCode).toBe(404)
    expect(err.code).toBe('NOT_FOUND')
  })

  it('CONFLICT: status 409', () => {
    const err = new ConflictError('conflict')
    expect(err.statusCode).toBe(409)
    expect(err.code).toBe('CONFLICT')
  })

  it('UNPROCESSABLE: status 422', () => {
    const err = new UnprocessableError('unprocessable')
    expect(err.statusCode).toBe(422)
    expect(err.code).toBe('UNPROCESSABLE')
  })

  it('RATE_LIMITED: status 429', () => {
    const err = new RateLimitedError('rate limited')
    expect(err.statusCode).toBe(429)
    expect(err.code).toBe('RATE_LIMITED')
  })

  it('INTERNAL: status 500', () => {
    const err = new InternalError('internal')
    expect(err.statusCode).toBe(500)
    expect(err.code).toBe('INTERNAL')
  })

  it('SERVICE_UNAVAILABLE: status 503', () => {
    const err = new ServiceUnavailableError('unavailable')
    expect(err.statusCode).toBe(503)
    expect(err.code).toBe('SERVICE_UNAVAILABLE')
  })

  it('GONE: status 410', () => {
    const err = new GoneError('gone')
    expect(err.statusCode).toBe(410)
    expect(err.code).toBe('GONE')
  })
})
```

#### `backend/src/__tests__/noConsoleCalls.test.js` (CREATE)

```javascript
const fs = require('fs')
const path = require('path')

describe('Zero console.* calls in production code', () => {
  const CONSOLE_PATTERNS = [
    { name: 'console.log', regex: /console\.log\s*\(/ },
    { name: 'console.error', regex: /console\.error\s*\(/ },
    { name: 'console.warn', regex: /console\.warn\s*\(/ },
    { name: 'console.info', regex: /console\.info\s*\(/ },
    { name: 'console.debug', regex: /console\.debug\s*\(/ }
  ]

  const PROD_DIRS = [
    path.join(__dirname, '..', 'controllers'),
    path.join(__dirname, '..', 'services'),
    path.join(__dirname, '..', 'middleware'),
    path.join(__dirname, '..', 'utils'),
    path.join(__dirname, '..', 'api')
  ]

  function scanDir(dir) {
    const files = fs.readdirSync(dir)
    let results = []
    for (const file of files) {
      const fullPath = path.join(dir, file)
      if (fs.statSync(fullPath).isDirectory()) {
        results = results.concat(scanDir(fullPath))
      } else if (file.endsWith('.js') && !file.endsWith('.test.js')) {
        const content = fs.readFileSync(fullPath, 'utf-8')
        results.push({ file: fullPath, content })
      }
    }
    return results
  }

  for (const { name, regex } of CONSOLE_PATTERNS) {
    it(`no ${name} calls in production code`, () => {
      const files = PROD_DIRS.flatMap(scanDir)
      const violations = files.filter(({ content }) => regex.test(content))
      expect(violations).toHaveLength(0)
    })
  }
})
```

#### `backend/src/__tests__/integration/authFlowRegression.test.js` (CREATE)

```javascript
const request = require('supertest')
const app = require('../../index')

describe('Auth flow regression', () => {
  const testEmail = `test-${Date.now()}@example.com`

  it('register succeeds with valid data', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: testEmail, password: 'Password123!' })
    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
  })

  it('login succeeds with valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: testEmail, password: 'Password123!' })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data).toHaveProperty('token')
  })

  it('token refresh returns new token', async () => {
    // Register + login to get tokens
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: testEmail, password: 'Password123!' })
    const refreshToken = loginRes.body.data.refreshToken

    // Refresh
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken })
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveProperty('token')
  })

  it('login fails with invalid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: testEmail, password: 'wrongpassword' })
    expect(res.status).toBe(401)
  })

  it('register fails with duplicate email', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: testEmail, password: 'Password123!' })
    expect(res.status).toBe(409)
  })
})
```

#### `frontend/src/__tests__/useAsyncState.test.ts` (CREATE)

```typescript
import { describe, it, expect, vi } from 'vitest'
import { useAsyncState } from '@/composables/useAsyncState'

describe('useAsyncState', () => {
  it('returns loading=true initially', () => {
    const { loading, data, error } = useAsyncState()
    expect(loading.value).toBe(true)
    expect(data.value).toBeNull()
    expect(error.value).toBeNull()
  })

  it('returns data on success', async () => {
    const { loading, data, execute } = useAsyncState()
    await execute(async () => ({ foo: 'bar' }))
    expect(loading.value).toBe(false)
    expect(data.value).toEqual({ foo: 'bar' })
    expect(error.value).toBeNull()
  })

  it('returns error on failure', async () => {
    const { loading, error, execute } = useAsyncState()
    try {
      await execute(async () => { throw new Error('fail') })
    } catch { /* expected */ }
    expect(loading.value).toBe(false)
    expect(error.value).toBeInstanceOf(Error)
    expect(error.value.message).toBe('fail')
  })

  it('can be reset', async () => {
    const { loading, data, reset } = useAsyncState()
    await execute(async () => ({ foo: 'bar' }))
    reset()
    expect(loading.value).toBe(true)
    expect(data.value).toBeNull()
  })
})
```

#### `frontend/cypress/component/ErrorToast.spec.ts` (CREATE)

```typescript
describe('ErrorToast', () => {
  it('renders error message', () => {
    cy.mount(ErrorToast, { props: { message: 'Something went wrong' } })
    cy.get('.error-toast').should('exist')
    cy.get('.error-toast').contains('Something went wrong')
  })

  it('renders with error styling', () => {
    cy.mount(ErrorToast, { props: { message: 'Error' } })
    cy.get('.error-toast').should('have.class', 'error')
  })

  it('can be manually dismissed', () => {
    cy.mount(ErrorToast, { props: { message: 'Dismiss me' } })
    cy.get('.error-toast .dismiss-btn').click()
    cy.get('.error-toast').should('not.exist')
  })

  it('auto-dismisses after configured timeout', () => {
    cy.mount(ErrorToast, { props: { message: 'Auto dismiss', timeout: 1000 } })
    cy.get('.error-toast').should('exist')
    cy.wait(1100)
    cy.get('.error-toast').should('not.exist')
  })
})
```

---

### d) Dependencies

- `sendSuccess`/`sendError` from `backend/src/utils/response.js`
- `AppError` class + 10 error codes from `backend/src/errors/HttpError.js`
- `ErrorToast.vue` — path to verify in `frontend/src/components/`
- `useAsyncState.ts` — path to verify in `frontend/src/composables/`
- Auth routes from `backend/src/api/routes.js`

---

### e) Risks/Edge Cases

- **[Console scan false positives]**: Comments containing `console.` may trigger false positives. Mitigation: the regex requires `console.log(` (with opening paren) to reduce false positives.
- **[Auth test data isolation]**: Integration tests create real users. Mitigation: use unique email per test run with `Date.now()`.
- **[Cypress auto-dismiss timing]**: 1-second timeout in test is short. Mitigation: use `cy.wait()` explicitly.

---

### f) Testing

#### Backend Unit Tests
- [ ] `backend/src/__tests__/responseHelpers.test.js` — CREATED (4 test cases)
- [ ] `backend/src/__tests__/appErrorHierarchy.test.js` — CREATED (12 test cases)
- [ ] `backend/src/__tests__/noConsoleCalls.test.js` — CREATED (5 test cases)
- [ ] `backend/src/__tests__/integration/authFlowRegression.test.js` — CREATED (5 test cases)

#### Frontend Tests
- [ ] `frontend/src/__tests__/useAsyncState.test.ts` — CREATED (4 test cases)
- [ ] `frontend/cypress/component/ErrorToast.spec.ts` — CREATED (4 test cases)

#### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run test:integration` — backend integration tests pass
- [ ] `npm run lint` — no lint errors
- [ ] `npm run typecheck` — frontend typecheck passes
- [ ] `npm run build` — frontend build passes
- [ ] `npm test -- --run` — frontend tests pass

---

### g) Migration Notes (if applicable)

No migrations needed.

---

### h) Files Changed

**Backend:**
```
backend/src/__tests__/responseHelpers.test.js                            → CREATE
backend/src/__tests__/appErrorHierarchy.test.js                          → CREATE
backend/src/__tests__/noConsoleCalls.test.js                             → CREATE
backend/src/__tests__/integration/authFlowRegression.test.js             → CREATE
```

**Frontend:**
```
frontend/src/__tests__/useAsyncState.test.ts                             → CREATE
frontend/cypress/component/ErrorToast.spec.ts                            → CREATE
```

---

### i) Code Review Checklist

- [ ] All test files follow existing naming conventions
- [ ] Backend tests use Jest patterns from `setupFilesAfterEnv`
- [ ] Frontend tests use Vitest patterns from existing `frontend/src/__tests__/`
- [ ] Cypress component tests use existing patterns from `frontend/cypress/component/`
- [ ] Console scan regex requires `(` after `console.` to avoid false positives
- [ ] Auth regression tests use unique emails to avoid conflicts
- [ ] No production code modified (test-only ticket)
- [ ] `npm test` passes with no regressions
- [ ] `npm test -- --run` passes for frontend

---

### j) Post-Deploy Verification

1. [ ] `npm test` passes (backend)
2. [ ] `npm run test:integration` passes (backend)
3. [ ] `npm run lint` passes (both)
4. [ ] `npm run typecheck` passes (frontend)
5. [ ] `npm run build` passes (frontend)
6. [ ] `npm test -- --run` passes (frontend)
7. [ ] All 6 new test files exist and run without errors
8. [ ] No regressions in existing test suites

---

*Fill in all sections before starting implementation. Update status as work progresses.*
