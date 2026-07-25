# 01_ARCHITECT_REQUIREMENT.md — Remove Plaintext API Key from Agent List Response

**Status**: planned
**Date created**: 2026-07-25
**Date completed**: 
**Author**: AI Assistant
**Scope**: Backend + Frontend
**Priority**: P2 (Security)
**Effort**: Small

---

## Requirement

`GET /agents` currently returns the full plaintext `api_key` in the response body. While bp-102 masked `api_key_hash` and `api_key_hash_prefix`, the actual secret — the plaintext API key — is still exposed to any client with `AGENT_READ` permission. This is a security gap: the key is visible in browser DevTools, network logs, and any intermediary that inspects the response.

The `api_key` should be removed from the list response entirely. The existing `/agents/:agentId/key` endpoint already provides a safe key preview (`substring(0, 8) + '***'`). The frontend must be updated to stop depending on the full `api_key` from the list.

---

## Existing Infrastructure Audit

### Backend API Check
- [x] API route exists: `backend/src/api/agents.js` — `GET /agents` returns raw DB rows including `api_key`
- [x] Controller exists: inline in `agents.js` (no separate controller file)
- [x] Service exists: `backend/src/services/AgentService.js` — `list()` returns full rows
- [x] Model exists: `backend/src/models/` — agents table schema
- [x] Validator exists: N/A (no input changes)
- [x] Route is mounted: `backend/src/api/v1/index.js` — `router.use('/agents', agentsRouter)`
- [x] OpenAPI JSDoc annotations exist: `agents.js` has `@openapi` annotations

### Frontend API Client Check
- [x] API client exists: `frontend/src/api/agents.ts`
- [x] API client functions cover all needed endpoints — `listAgents()` returns `{ agents: Agent[] }`
- [x] API client follows existing patterns — uses `get` from `./client`

### Frontend UI Check
- [x] View component exists: `frontend/src/views/AgentList.vue` — uses `agent.api_key` via `formatKeyPreview()`
- [x] View component exists: `frontend/src/views/AIAssistant.vue` — uses `agent.api_key` for `getAgentHistory()` auth
- [x] Component exists: N/A (inline in views)
- [x] Route exists: `frontend/src/router/index.ts` — `/agents` route
- [x] Existing tab/section: AgentList has "Agents" tab

### Integration Check
- [x] Frontend API client can call existing backend endpoints — yes
- [x] Response shapes match — snake_case from backend, frontend uses as-is
- [x] Auth tokens are used correctly — JWT for most endpoints, `x-api-key` for agent history
- [x] Error handling matches existing patterns — try/catch with error messages

### Key Insight

This is a **Backend + Frontend** task. The backend must stop returning `api_key` in the list response, and the frontend must stop depending on it. The agent history endpoint currently requires `x-api-key` header auth — the frontend fetches this from the list response. This coupling must be broken.

---

## Scope

### In Scope
- Remove `api_key` field from `GET /agents` response (backend)
- Update `maskAgentList()` to also strip `api_key`
- Update frontend `AgentList.vue` to use `getAgentKeyInfo()` for key preview instead of `formatKeyPreview(agent.api_key)`
- Update frontend `AIAssistant.vue` to use JWT auth for agent history (or remove `x-api-key` dependency)
- Update frontend `Agent` interface to remove `api_key` field
- Update backend tests to verify `api_key` is not in list response
- Update frontend tests with mock data that doesn't include `api_key`

### Out of Scope
- Changing the agent history endpoint auth mechanism (remains `x-api-key` for agent-to-agent calls)
- Masking `api_key` in other endpoints (`POST /agents/create` intentionally returns plaintext key once)
- Frontend UI redesign (only functional changes to remove `api_key` dependency)
- Credentials API (already handled differently via `keyMasked` field)

---

## Pending Scope Items to Present to User

**MANDATORY**: Before presenting this ticket to the user, list all deferred improvements found in previous tickets' "Out of Scope" sections that are relevant to this ticket's domain.

### Items to Present

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-102 | Credentials API `api_key_encrypted` masking (spec called for it, PR deferred) | Security | Could be added to this ticket or separate | ☐ |
| 2 | bp-102 | Agent history endpoint could accept JWT instead of `x-api-key` | Security | bp-109-agent-history-jwt-auth | ☐ |

---

## Deferred Improvements Found (Internal Tracking)

| # | From Ticket | Improvement | Category | Suggested Next Ticket |
|---|-------------|-------------|----------|----------------------|
| 1 | bp-102 | Credentials API `api_key_encrypted` masking | Security | Extend this ticket |
| 2 | bp-102 | Agent history endpoint JWT auth | Security | bp-109-agent-history-jwt-auth |

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/api/agents.js` | MODIFY | `maskAgentList()` also strips `api_key` field |
| `frontend/src/api/agents.ts` | MODIFY | Remove `api_key` from `Agent` interface |
| `frontend/src/views/AgentList.vue` | MODIFY | Use `getAgentKeyInfo()` for preview, remove `formatKeyPreview(agent.api_key)` |
| `frontend/src/views/AIAssistant.vue` | MODIFY | Remove `api_key` dependency for agent history auth |
| `backend/src/__tests__/agentMasking.test.js` | MODIFY | Add test verifying `api_key` not in list response |
| `frontend/src/__tests__/agentEdit.test.ts` | MODIFY | Remove `api_key` from mock data |
| `database` | NONE | No schema changes |
| `config` | NONE | No new env vars |

---

## Known Unknowns

1. **Agent history auth**: The `GET /agents/:agentId/history` endpoint uses `x-api-key` for auth. If the frontend no longer has the full key, how does it authenticate? Options: (a) switch to JWT auth for this endpoint, (b) use a separate token exchange, (c) keep the key but only expose it via a dedicated secure endpoint.
2. **AIAssistant.vue dependency**: This view uses `api_key` from the list to call `getAgentHistory()`. Removing `api_key` from the list breaks this. Must decide whether to change the history endpoint auth or provide a different mechanism.

---

## Important Design Decisions

**DECISION POINTS** — Items that need user confirmation.

1. **Agent history endpoint auth**: Currently uses `x-api-key` header. Options:
   - **Option A (Recommended)**: Change `GET /agents/:agentId/history` to accept JWT auth (user token). The endpoint already has access to `req.user.userId` via `verifyTokenOrAgent`. This is cleaner and eliminates the need to send plaintext keys to the browser.
   - **Option B**: Keep `x-api-key` but provide a separate `GET /agents/:agentId/api-key` endpoint that returns the key only when explicitly requested (with audit logging).
   - **Option C**: Leave as-is and accept that the frontend needs the key for history. (Not recommended — defeats the purpose.)

---

## Acceptance Criteria

1. [ ] [Backend API] `GET /agents` response does NOT contain `api_key` field
2. [ ] [Backend API] `GET /agents` response still contains `api_key_hash` as `'***'` and `api_key_hash_prefix` as `'***'` (bp-102 behavior preserved)
3. [ ] [Backend API] `POST /agents/create` still returns `generatedApiKey` as plaintext (intentional)
4. [ ] [Backend API] `GET /agents/:agentId/key` still returns key preview
5. [ ] [Backend API] `GET /agents/:agentId/history` works with JWT auth (if Option A chosen)
6. [ ] [Backend API] New test verifies `api_key` is NOT in list response
7. [ ] [Frontend] `AgentList.vue` displays key preview without using `api_key` from list
8. [ ] [Frontend] `AIAssistant.vue` can fetch agent history without `api_key` from list
9. [ ] [Frontend] `Agent` interface no longer includes `api_key` field
10. [ ] [Frontend] All existing frontend tests pass with updated mock data
11. [ ] [Both] `npm run test:coverage` passes (60% min threshold)
12. [ ] [Both] `npm run lint` passes
13. [ ] [Both] `npm run typecheck` passes

---

## Out of Scope

- Changing `POST /agents/create` to not return the plaintext key (user needs it once at creation)
- Changing the agent-to-agent auth mechanism (`x-api-key` header for agent self-auth)
- Credentials API changes (out of scope per bp-102 review)
- Frontend UI redesign

---

## Performance Considerations

- Expected load: same as current agent list endpoint
- N+1 queries to avoid: none introduced (list query unchanged, just response shape changes)
- Caching strategy: none needed
- Pagination needed: NO (agents list is small)

---

## Security Considerations

- [x] Authentication required: YES — JWT via `verifyTokenOrAgent`
- [x] Authorization check: YES — `requireAnyPermission('AGENT_READ')`
- [x] Input validation: N/A (no input changes)
- [x] Rate limiting: inherits existing rate limits
- [x] Sensitive data handling: THIS IS THE FIX — remove plaintext `api_key` from response
- [x] SQL injection protection: parameterized queries (no change)

---

## Testing Checklist

### Test-First Requirement (if 04_SPECIFICATION.md exists)

- [ ] Empty test stub files created BEFORE any production code (listed as first file operations)
- [ ] Test stubs contain imports, `describe` blocks, and stub `it` blocks
- [ ] After implementation: test stubs filled in with actual assertions

### Backend Tests
- [x] Unit test file: `backend/src/__tests__/agentMasking.test.js` — EXTENDED with `api_key` removal test
- [ ] Every changed method has at least one test case
- [ ] Happy path AND error paths tested (not just happy path)
- [ ] **Coverage threshold (60%)**: `npm run test:coverage` — min 60% lines, functions, branches, statements

### Frontend Tests
- [ ] Unit test file: `frontend/src/__tests__/agentEdit.test.ts` — EXTENDED (remove `api_key` from mock)
- [ ] Unit test file: `frontend/src/__tests__/api-contract.test.ts` — EXTENDED if response shape changed
- [ ] Every changed API client function has at least one test case
- [ ] Loading, error, and empty states tested

### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run test:coverage` — backend coverage threshold passes (60%)
- [ ] `npm run lint` — no lint errors
- [ ] `npm run typecheck` — frontend typecheck passes
- [ ] `npm run build` — frontend build passes
- [ ] `npm test -- --run --coverage` — frontend tests + coverage pass (60%)

---

## Anti-Patterns to Avoid

- ❌ **Breaking agent history endpoint** — must ensure `GET /agents/:agentId/history` still works after removing `api_key` from list
- ❌ **Forgetting frontend mock data** — `agentEdit.test.ts` uses `api_key` in mocks, must update
- ❌ **Incomplete masking** — must strip `api_key` AND keep `api_key_hash`/`api_key_hash_prefix` masked
- ❌ **Not updating AIAssistant.vue** — this view has a hard dependency on `api_key` from the list

---

*Fill in all sections before starting implementation. The existing infrastructure audit is the most important section — it prevents agents from creating redundant code.*
