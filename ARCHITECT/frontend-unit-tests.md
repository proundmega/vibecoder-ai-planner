# ARCHITECT Plan: Frontend Unit Tests

## Identify

**Problem**: Frontend has zero Vitest unit tests. All coverage is Cypress (4 component + 4 e2e tests). This means pure logic bugs (API response parsing, error handling, store computations) are only caught by slow integration tests or in production.

**Root cause**: No test infrastructure in `frontend/src/__tests__/`. Backend uses `src/__tests__/*.test.js` with Jest — frontend should mirror this pattern.

**Impact**: 
- `auth.js` response extraction bug (session #1) — only caught by manual testing
- `agents.js` wrong HTTP methods — only caught by manual testing
- `tickets.js` error swallowing — only caught by manual testing
- No regression protection for API layer

**Scope**: Pure logic functions only. Skip Vue components (Cypress component tests cover those).

**Files to test**:
1. `frontend/src/api/auth.js` — `registerUser`, `loginUser` functions
2. `frontend/src/api/agents.js` — `getAgentTickets`, `createTicket`, `getAgentHistory`
3. `frontend/src/api/tickets.js` — `deleteTicket`, `updateTicket`
4. `frontend/src/api/client.js` — `get`, `post`, `patch`, `put`, `del` functions
5. `frontend/src/stores/auth.js` — `login`, `register`, `logout`, `canCreateTicket`, etc.

---

## Plan

### Approach

**Pattern**: Each test file mirrors its source module. Test file at `frontend/src/__tests__/<module>.test.js`.

**Mocking strategy**:
- `client.js` functions are tested directly — they import `axios` which is mocked via Vitest
- `auth.js`, `agents.js`, `tickets.js` call `client.js` functions — mock `client.js` exports
- `stores/auth.js` calls API functions — mock the API module imports

**Test structure per file**:
```javascript
// frontend/src/__tests__/auth.test.js
import { registerUser, loginUser } from '../api/auth';
import * as client from '../api/client';

vi.mock('../api/client');

describe('auth API', () => {
  beforeEach(() => vi.clearAllMocks());
  
  it('extracts token from { success, data } response', async () => {
    client.post.mockResolvedValue({ success: true, data: { token: 'abc', user: { id: 1 } } });
    const result = await loginUser({ email: 'a@b.com', password: 'pass' });
    expect(result.token).toBe('abc');
  });
});
```

### Test Files & Coverage

#### 1. `frontend/src/__tests__/client.test.js` (Priority: HIGH)
Tests the HTTP client wrapper — the foundation all other modules depend on.

| Test | What it verifies |
|------|-----------------|
| `get()` sends GET request with config | Basic HTTP method |
| `get()` passes custom headers | Agent API calls need `X-API-Key` |
| `post()` sends POST request | Basic HTTP method |
| `patch()` sends PATCH request | Basic HTTP method |
| `put()` sends PUT request | Basic HTTP method |
| `del()` sends DELETE request | Basic HTTP method |
| `get()` returns response data | Response extraction |
| `get()` throws on network error | Error propagation |
| `get()` throws on 401 | Auth error handling |
| `get()` throws on 403 | Permission error handling |

#### 2. `frontend/src/__tests__/auth.test.js` (Priority: HIGH)
Tests API auth functions — was the source of the response extraction bug.

| Test | What it verifies |
|------|-----------------|
| `registerUser()` returns token and user | Response extraction |
| `registerUser()` extracts from `{ success, data }` wrapper | Backend response format |
| `registerUser()` throws on API error | Error propagation |
| `loginUser()` returns token and user | Response extraction |
| `loginUser()` extracts from `{ success, data }` wrapper | Backend response format |
| `loginUser()` throws on API error | Error propagation |

#### 3. `frontend/src/__tests__/agents.test.js` (Priority: HIGH)
Tests agent API functions — had wrong HTTP methods and endpoints.

| Test | What it verifies |
|------|-----------------|
| `getAgentTickets()` sends GET request | HTTP method fix |
| `getAgentTickets()` uses correct URL | Endpoint fix |
| `createTicket()` sends POST request | HTTP method |
| `createTicket()` uses ticket creation endpoint | Endpoint fix |
| `getAgentHistory()` sends GET request | HTTP method fix |
| `getAgentHistory()` uses correct URL | Endpoint fix |

#### 4. `frontend/src/__tests__/tickets.test.js` (Priority: MEDIUM)
Tests ticket API functions — had error swallowing in `deleteTicket`.

| Test | What it verifies |
|------|-----------------|
| `deleteTicket()` throws on API error | Error propagation (not swallowed) |
| `updateTicket()` sends PATCH request | HTTP method |
| `updateTicket()` passes body data | Request body |
| `getProjectTickets()` sends GET request | HTTP method |
| `createTicket()` sends POST request | HTTP method |

#### 5. `frontend/src/__tests__/auth-store.test.js` (Priority: MEDIUM)
Tests Pinia store logic — token/permission management.

| Test | What it verifies |
|------|-----------------|
| `login()` sets token and user in state | State mutation |
| `login()` extracts permissions from user | Permission parsing |
| `logout()` clears token, user, permissions | State cleanup |
| `canCreateTicket()` returns true for project_admin | Permission check |
| `canCreateTicket()` returns false for user | Permission check |
| `canDeleteTicket()` returns true for project_admin | Permission check |
| `canDeleteTicket()` returns false for user | Permission check |
| `canAccessUsers()` returns true for project_admin | Permission check |
| `canAccessUsers()` returns false for user | Permission check |

### Total: ~35 tests across 5 files

---

## Execute

### Step 1: Infrastructure
- [ ] Create `frontend/src/__tests__/` directory
- [ ] Verify Vitest config picks up `src/__tests__/*.test.js`
- [ ] Add any needed Vitest setup (global mocks, etc.)

### Step 2: Test files (in order of dependency)
- [ ] `frontend/src/__tests__/client.test.js` — foundation, mocks axios
- [ ] `frontend/src/__tests__/auth.test.js` — mocks client.js
- [ ] `frontend/src/__tests__/agents.test.js` — mocks client.js
- [ ] `frontend/src/__tests__/tickets.test.js` — mocks client.js
- [ ] `frontend/src/__tests__/auth-store.test.js` — mocks auth.js API

### Step 3: Verification
- [ ] Run `npm test -- --run` — all new tests pass
- [ ] Run `npm run lint` — no new warnings
- [ ] Run `npm run build` — still succeeds

### Step 4: Commit
- [ ] Commit with message: `test: add Vitest unit tests for frontend API layer`

---

## Evaluate

**Success criteria**:
1. All 35 tests pass
2. No regression in existing Cypress tests
3. Lint passes
4. Build succeeds
5. Test coverage report shows API layer functions are covered

**What we're NOT testing** (intentionally):
- Vue components — covered by Cypress component tests
- Router — covered by Cypress e2e tests
- UI rendering — covered by Cypress e2e tests
- Browser interactions (clicks, drag-drop) — covered by Cypress e2e tests

**Future additions** (if time permits):
- `frontend/src/__tests__/projects.test.js` — project API functions
- `frontend/src/__tests__/user.test.js` — user API functions
