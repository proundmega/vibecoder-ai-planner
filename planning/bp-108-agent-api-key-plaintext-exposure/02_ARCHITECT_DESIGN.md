# 02_ARCHITECT_DESIGN.md — Remove Plaintext API Key from Agent List Response

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend + Frontend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, `04_SPECIFICATION.md`

---

## Problem Statement

`GET /agents` returns the full plaintext `api_key` in the response body. While bp-102 masked `api_key_hash` and `api_key_hash_prefix`, the actual secret is still exposed. Any client with `AGENT_READ` permission can read the full API key from the JSON response or browser DevTools.

The frontend depends on `api_key` in two places:
1. `AgentList.vue:229` — `formatKeyPreview(agent.api_key)` truncates to 8 chars for display
2. `AIAssistant.vue:34` — uses `api_key` as `x-api-key` header for `getAgentHistory()` calls

---

## Current State

### Existing Backend
- `GET /api/v1/agents` — returns `{ agents: [...] }` where each agent includes `api_key` (plaintext)
- `maskAgentList()` in `agents.js` masks `api_key_hash` and `api_key_hash_prefix` but NOT `api_key`
- `GET /api/v1/agents/:agentId/key` — returns `{ keyPreview: "ak_xxxx***" }` (safe preview)
- `GET /api/v1/agents/:agentId/history` — requires `x-api-key` header for auth

### Existing Frontend
- `AgentList.vue` — uses `formatKeyPreview(agent.api_key)` to show truncated key
- `AIAssistant.vue` — reads `agent.api_key` to pass as `x-api-key` header to `getAgentHistory()`
- `agents.ts` — `Agent` interface includes `api_key: string | null`
- `agentEdit.test.ts` — mock data includes `api_key` field

### Gap Analysis
- Backend returns `api_key` in list response — SHOULD NOT
- Frontend depends on `api_key` from list for two use cases — MUST BE REPLACED
- Agent history endpoint requires `x-api-key` — needs alternative auth mechanism

---

## Design

### Option A: Remove `api_key` from list + Switch history to JWT auth (Recommended)

**Backend changes:**
1. Extend `maskAgentList()` to also delete the `api_key` field:
```javascript
function maskAgentList(agents) {
  return agents.map(agent => {
    const masked = { ...agent };
    delete masked.api_key;  // NEW: remove plaintext key
    if (masked.api_key_hash) masked.api_key_hash = '***';
    if (masked.api_key_hash_prefix) masked.api_key_hash_prefix = '***';
    return masked;
  });
}
```

2. Change `GET /agents/:agentId/history` to accept JWT auth (via `verifyTokenOrAgent` middleware) instead of requiring `x-api-key`. The endpoint already has access to `req.user.userId` for authorization.

**Frontend changes:**
1. `AgentList.vue` — use `getAgentKeyInfo(agentId)` to fetch key preview on-demand (or accept the key preview comes from a separate call)
2. `AIAssistant.vue` — call `getAgentHistory()` without `x-api-key` header (JWT auth handles it)
3. `agents.ts` — remove `api_key` from `Agent` interface

**Pros**: Cleanest security fix. No plaintext key ever reaches the browser after initial creation.
**Cons**: Requires changing the history endpoint auth (minor, since JWT is already available).

### Option B: Remove `api_key` from list + Add dedicated key endpoint

**Backend changes:**
1. Same `maskAgentList()` change as Option A
2. Add `GET /agents/:agentId/secret-key` endpoint that returns the full key only when explicitly requested (with audit logging)

**Frontend changes:**
1. `AIAssistant.vue` — call the new endpoint to get the key before calling history
2. Same `AgentList.vue` changes as Option A

**Pros**: Explicit key retrieval with audit trail.
**Cons**: More complex. Key still reaches the browser. Doesn't fully solve the exposure problem.

### Option C: Keep `api_key` in list but mask it like bp-102

**Backend changes:**
1. Extend `maskAgentList()` to set `api_key = '***'`

**Frontend changes:**
1. Breaks both `AgentList.vue` and `AIAssistant.vue` (they need the actual key)

**Pros**: Simplest backend change.
**Cons**: Breaks frontend functionality. Not a real fix — just hides the display.

---

**Decision**: Option A — cleanest, most secure, follows defense-in-depth.

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/api/agents.js` | MODIFY | `maskAgentList()`: add `delete masked.api_key`; history endpoint: add `verifyTokenOrAgent` middleware |
| `frontend/src/api/agents.ts` | MODIFY | Remove `api_key` from `Agent` interface |
| `frontend/src/views/AgentList.vue` | MODIFY | Remove `formatKeyPreview(agent.api_key)`, use key preview from separate call or display placeholder |
| `frontend/src/views/AIAssistant.vue` | MODIFY | Remove `apiKey` ref and `agent?.api_key` dependency, call `getAgentHistory()` without `x-api-key` |
| `backend/src/__tests__/agentMasking.test.js` | MODIFY | Add test: `api_key` NOT in list response |
| `frontend/src/__tests__/agentEdit.test.ts` | MODIFY | Remove `api_key` from mock data |

---

## Data Flow Diagram

```
Before:
[User] → [AgentList.vue] → [GET /agents] → [agents.js] → [AgentService.list()]
   ↑                                ↓
   └── formatKeyPreview(api_key) ←── api_key in response (SECURITY GAP)

After:
[User] → [AgentList.vue] → [GET /agents] → [agents.js] → [AgentService.list()]
   ↑                                ↓
   └── getAgentKeyInfo(id) ←── api_key NOT in response (SECURE)
         ↓
   [GET /agents/:id/key] → keyPreview only
```

### Error Handling Strategy

No changes to error handling. Existing patterns apply:
- 401 for missing auth
- 403 for insufficient permissions
- 404 for agent not found
- 500 for unexpected errors

---

## Dependencies

### Backend Dependencies
- `AgentService.list()` — no change needed (still returns full rows, masking happens in controller)
- `verifyTokenOrAgent` middleware — reuse for history endpoint
- `requireAnyPermission('AGENT_READ')` — reuse for history endpoint authorization

### Frontend Dependencies
- `getAgentKeyInfo()` in `agents.ts` — already exists, returns `{ keyPreview }`
- `getAgentHistory()` in `agents.ts` — already exists, will work without `x-api-key` header after backend change
- `formatKeyPreview()` in `AgentList.vue` — will be removed or refactored

### Cross-Cutting Dependencies
- OpenAPI spec: update `GET /agents` response schema (remove `api_key` property)
- Generated TypeScript types: regenerate after OpenAPI change
- `frontend/src/api/validator.ts`: update if `api_key` is validated

---

## Config / Environment Changes

- [ ] New environment variables: NONE
- [ ] New database migrations: NONE
- [ ] New npm dependencies: NONE
- [ ] Existing config changes: NONE

---

## Database Changes

### New Tables
```sql
-- None
```

### New Columns
```sql
-- None
```

### Indexes
```sql
-- None
```

### Migrations
- NONE

---

## Security Considerations

- [x] New endpoints require authentication: history endpoint gains JWT auth (via `verifyTokenOrAgent`)
- [x] New endpoints require specific permissions: history endpoint gains `requireAnyPermission('AGENT_READ')`
- [x] Input validated against: N/A (no input changes)
- [x] Rate limiting: inherits existing rate limits
- [x] Sensitive data in responses: REMOVED — `api_key` no longer in list response
- [x] SQL injection protection: parameterized queries (no change)

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Backend unit | Jest | `backend/src/__tests__/agentMasking.test.js` | Masking logic, `api_key` removal |
| Frontend unit | Vitest | `frontend/src/__tests__/agentEdit.test.ts` | Mock data consistency, API client |
| Contract | Vitest | `frontend/src/__tests__/api-contract.test.ts` | Response shape validation |

### Bash Integration Suite

No bash integration test needed — this is a response shape change, not a new endpoint.

---

## Risks and Edge Cases

### Backend Risks
- **[History endpoint auth change]**: Changing from `x-api-key` to JWT could break existing agent-to-agent calls that use the API key. Mitigation: keep `x-api-key` as fallback (check JWT first, then API key).
- **[Agent list backward compatibility]**: External consumers of the API that depend on `api_key` in the list will break. Mitigation: this is intentional — they should use `/agents/:id/key` instead.

### Frontend Risks
- **[AIAssistant.vue history call]**: If the history endpoint doesn't accept JWT, the frontend can't fetch history. Mitigation: implement JWT auth on history endpoint first.
- **[AgentList.vue key preview]**: Removing `api_key` means no key preview in the list. Mitigation: either fetch key preview per-agent (N+1) or show a placeholder (e.g., "••••••••").

### Edge Cases
1. **[Agent with no API key]**: `api_key` is null — `delete masked.api_key` is a no-op, no crash
2. **[Agent with revoked key]**: Same as above — `api_key` is null
3. **[POST /agents/create]**: Still returns `generatedApiKey` — this is intentional and NOT affected
4. **[Agent self-auth via x-api-key]**: Agent-to-agent calls still use `x-api-key` header — NOT affected (this is a different auth path)

---

## Alternative Designs Considered

### Alternative 1: Keep `api_key` in list, mask in frontend
- **Pros**: No backend change needed
- **Cons**: Key still in JSON response (visible in DevTools). Not a real security fix.
- **Decision**: Rejected — the key should never reach the browser

### Alternative 2: Add separate `GET /agents/:id/key` for full key
- **Pros**: Explicit key retrieval with audit trail
- **Cons**: Key still reaches the browser. More complex.
- **Decision**: Rejected — Option A is simpler and more secure

### Alternative 3: Use short-lived tokens for agent history
- **Pros**: Most secure — no persistent key in browser
- **Cons**: Over-engineered for this use case. Significant refactor.
- **Decision**: Rejected — JWT auth is sufficient

---

## Pending Scope Items to Present to User

No deferred improvements found in previous tickets that are directly blocking this ticket. The bp-102 credentials masking was considered and confirmed as not needed (credentials API already uses `keyMasked`).

---

## Specification Generation

- [x] `04_SPECIFICATION.md` has been created with exact file operations for each file
- [x] Test expectations are specific (not "test it works" but "returns 200 without api_key field")
- [x] Edge cases are enumerated explicitly
- [x] Imports and dependencies are listed per file
- [x] **Pending scope items presented to user**: All deferred improvements from previous tickets have been listed above and presented to the user

---

*This design document guides implementation. The "Extend Existing Structure" section is the most important — it tells the agent exactly how to add to what already exists rather than creating new code from scratch.*
