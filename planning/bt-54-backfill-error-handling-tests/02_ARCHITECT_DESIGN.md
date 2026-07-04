# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend | Frontend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, bp-54 (Error Handling)

---

## Problem Statement

bp-54 introduced structured error handling (`response.js` helpers, `AppError` hierarchy, `ErrorToast`, `useAsyncState`, console call removal) but added no tests. Without tests, regressions in error response shapes, error code taxonomy, component behavior, and auth flow are impossible to detect automatically.

---

## Current State

### Existing Backend
- `sendSuccess(res, data, requestId)` — `backend/src/utils/response.js`
- `sendError(res, error)` — `backend/src/utils/response.js`
- `AppError` class — `backend/src/errors/HttpError.js` with 10 error codes
- Error codes: BAD_REQUEST, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, CONFLICT, UNPROCESSABLE, RATE_LIMITED, INTERNAL, SERVICE_UNAVAILABLE, GONE

### Existing Frontend
- `ErrorToast.vue` — `frontend/src/components/ErrorToast.vue` (verify path)
- `useAsyncState()` — `frontend/src/composables/useAsyncState.ts` (verify path)
- Auth flow: login, register, token refresh via `frontend/src/stores/auth.js`

### Gap Analysis
- **No tests** for `sendSuccess`/`sendError` response shapes
- **No tests** for `AppError` class hierarchy
- **No tests** for the 10 error codes
- **No tests** for zero `console.*` calls policy
- **No component tests** for `ErrorToast`
- **No composable tests** for `useAsyncState`
- **No regression tests** for auth flow

---

## Design

### Test Architecture

#### Backend Unit Tests (Jest)

**`backend/src/__tests__/responseHelpers.test.js`**

```javascript
const { sendSuccess, sendError } = require('../../utils/response')

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

  it('includes requestId from request object', () => {
    const res = { json: jest.fn() }
    const req = { id: 'req-456' }
    sendSuccess(res, {}, req)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'req-456'
    }))
  })
})

describe('sendError', () => {
  it('responds with { success: false, error: { code, message } }', () => {
    const res = { json: jest.fn() }
    const error = new Error('bad request')
    sendError(res, error, 400)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'bad request' }
    })
  })

  it('maps error codes to HTTP status codes', () => {
    // Test: 400 → BAD_REQUEST, 401 → UNAUTHORIZED, etc.
  })
})
```

**`backend/src/__tests__/appErrorHierarchy.test.js`**

```javascript
const { AppError, BadRequestError, UnauthorizedError, ... } = require('../../errors/HttpError')

describe('AppError hierarchy', () => {
  it('AppError extends Error', () => {
    const err = new AppError('test', 500)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('AppError')
  })

  it('AppError has code, statusCode, and isAppError properties', () => {
    const err = new AppError('test', 500, 'TEST_CODE')
    expect(err.code).toBe('TEST_CODE')
    expect(err.statusCode).toBe(500)
    expect(err.isAppError).toBe(true)
  })
})

describe('Error code taxonomy (10 codes)', () => {
  it('BAD_REQUEST: status 400', () => { ... })
  it('UNAUTHORIZED: status 401', () => { ... })
  it('FORBIDDEN: status 403', () => { ... })
  it('NOT_FOUND: status 404', () => { ... })
  it('CONFLICT: status 409', () => { ... })
  it('UNPROCESSABLE: status 422', () => { ... })
  it('RATE_LIMITED: status 429', () => { ... })
  it('INTERNAL: status 500', () => { ... })
  it('SERVICE_UNAVAILABLE: status 503', () => { ... })
  it('GONE: status 410', () => { ... })
})
```

**`backend/src/__tests__/noConsoleCalls.test.js`**

```javascript
const fs = require('fs')
const path = require('path')

describe('Zero console.* calls in production code', () => {
  const PRODUCTION_PATTERNS = [
    'console\\.log',
    'console\\.error',
    'console\\.warn',
    'console\\.info',
    'console\\.debug'
  ]

  const PROD_PATHS = [
    'backend/src/controllers',
    'backend/src/services',
    'backend/src/middleware',
    'backend/src/utils',
    'backend/src/api'
  ]

  it('no console.log calls in production code', () => { ... })
  it('no console.error calls in production code', () => { ... })
  it('no console.warn calls in production code', () => { ... })
  it('no console.info calls in production code', () => { ... })
  it('no console.debug calls in production code', () => { ... })
})
```

#### Frontend Tests (Vitest + Cypress)

**`frontend/src/__tests__/useAsyncState.test.ts`**

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
    await execute(async () => { throw new Error('fail') })
    expect(loading.value).toBe(false)
    expect(error.value).toBeInstanceOf(Error)
    expect(error.value.message).toBe('fail')
  })
})
```

**`frontend/cypress/component/ErrorToast.spec.ts`**

```typescript
describe('ErrorToast', () => {
  it('renders error message', () => {
    cy.mount(ErrorToast, { props: { message: 'Something went wrong' } })
    cy.get('.error-toast').contains('Something went wrong')
  })

  it('auto-dismisses after 5 seconds', () => {
    cy.mount(ErrorToast, { props: { message: 'Will auto-dismiss' } })
    cy.get('.error-toast').should('exist')
    // Wait and verify dismissal
  })

  it('can be manually dismissed', () => {
    cy.mount(ErrorToast, { props: { message: 'Manual dismiss' } })
    cy.get('.dismiss-btn').click()
    cy.get('.error-toast').should('not.exist')
  })
})
```

#### Auth Flow Regression Tests

**`backend/src/__tests__/integration/authFlowRegression.test.js`**

```javascript
const request = require('supertest')
const app = require('../../index')

describe('Auth flow regression', () => {
  it('login succeeds with valid credentials', async () => { ... })
  it('register succeeds with valid data', async () => { ... })
  it('token refresh returns new token', async () => { ... })
  it('login fails with invalid credentials', async () => { ... })
  it('register fails with duplicate email', async () => { ... })
})
```

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/__tests__/responseHelpers.test.js` | CREATE | Test sendSuccess/sendError |
| `backend/src/__tests__/appErrorHierarchy.test.js` | CREATE | Test AppError + 10 error codes |
| `backend/src/__tests__/noConsoleCalls.test.js` | CREATE | Regex scan for console.* |
| `backend/src/__tests__/integration/authFlowRegression.test.js` | CREATE | Auth flow regression tests |
| `frontend/src/__tests__/useAsyncState.test.ts` | CREATE | Composable test |
| `frontend/cypress/component/ErrorToast.spec.ts` | CREATE | Component test |

---

## Data Flow Diagram

```
[sendSuccess test] → [call sendSuccess(res, data)] → [assert res.json called with correct shape]
[sendError test] → [call sendError(res, error)] → [assert res.json called with error shape]
[AppError test] → [new AppError(...)] → [assert instanceof Error, properties set]
[Console scan] → [fs.readdir(src/)] → [regex match on each file] → [assert zero matches]
[ErrorToast test] → [mount component] → [assert DOM contains message] → [assert auto-dismiss]
[useAsyncState test] → [call composable] → [assert loading/data/error states]
[Auth regression] → [supertest POST /auth/login] → [assert 200 + token]
```

---

## Dependencies

### Backend Dependencies
- `sendSuccess`/`sendError` from `backend/src/utils/response.js`
- `AppError` class from `backend/src/errors/HttpError.js`
- Auth routes from `backend/src/api/routes.js` (for regression tests)

### Frontend Dependencies
- `ErrorToast.vue` — path to verify
- `useAsyncState.ts` — path to verify
- Existing Vitest setup — `frontend/src/__tests__/`
- Existing Cypress setup — `frontend/cypress/component/`

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Backend unit | Jest | `backend/src/__tests__/responseHelpers.test.js` | Response shape correctness |
| Backend unit | Jest | `backend/src/__tests__/appErrorHierarchy.test.js` | Error class behavior |
| Backend unit | Jest | `backend/src/__tests__/noConsoleCalls.test.js` | Console call policy enforcement |
| Backend integration | Jest + real PG | `backend/src/__tests__/integration/authFlowRegression.test.js` | Auth flow correctness |
| Frontend unit | Vitest | `frontend/src/__tests__/useAsyncState.test.ts` | Composable state management |
| Component | Cypress | `frontend/cypress/component/ErrorToast.spec.ts` | UI rendering and auto-dismiss |

---

## Risks and Edge Cases

### Backend Risks
- **[Console scan false positives]**: Comments or strings containing `console.` may trigger false positives. Mitigation: use AST-based scanning or exclude comments/strings.
- **[Auth test data isolation]**: Integration tests may create real users. Mitigation: use unique email per test run.

### Frontend Risks
- **[Cypress auto-dismiss timing]**: 5-second auto-dismiss may be flaky in CI. Mitigation: use `cy.tick()` or increase timeout.

---

## Alternative Designs Considered

### Alternative 1: Single test file for all error handling
- **Pros**: Simpler structure
- **Cons**: Violates separation of concerns
- **Decision**: Separate files follow existing patterns

### Alternative 2: E2E tests for ErrorToast
- **Pros**: More realistic
- **Cons**: Slower, harder to isolate; component tests are more appropriate
- **Decision**: Component tests for ErrorToast

---

*This design document guides implementation.*
