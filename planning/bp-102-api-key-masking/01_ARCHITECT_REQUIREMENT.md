# 01_ARCHITECT_REQUIREMENT.md — API Key Masking in List Responses

**Status**: completed
**Date created**: 2025-07-24
**Date completed**: 2025-07-24 
**Author**: AI Assistant
**Scope**: Backend
**Priority**: P2 (Security)
**Effort**: Small

---

## Requirement

The `GET /agents` endpoint returns raw database rows that include `api_key_hash` and `api_key_hash_prefix` fields. These should be masked in list responses to prevent exposing internal hash values. Similarly, credentials and provider configs should not expose raw encrypted values.

---

## Existing Infrastructure Audit

### Backend API Check
- [x] Agent list endpoint: `backend/src/api/agents.js:87-95` — returns `AgentService.list(req.user.userId)` which returns raw DB rows including `api_key_hash`, `api_key_hash_prefix`
- [x] Key preview endpoint: `backend/src/api/agents.js:266-283` — already masks with `substring(0, 8) + '***'`
- [x] Masking utility exists: `backend/src/utils/logger.js` — `maskSensitive()` masks fields containing `apikey`, `token`, `secret`
- [x] Credentials API: `backend/src/api/credentials.js` — may have similar exposure

### Key Insight

The `maskSensitive()` function in logger.js already handles this. We just need to apply it in the agent list response. The pattern is simple: map over list results and mask sensitive fields before returning.

---

## Scope

### In Scope
- Mask `api_key_hash` and `api_key_hash_prefix` in `GET /agents` response
- Mask `api_key_encrypted` in `GET /credentials` and provider config list responses
- Use existing `maskSensitive()` utility from logger.js

### Out of Scope
- Masking in WebSocket terminal proxy (separate concern)
- Masking in agent provider-config endpoint (returns decrypted key intentionally)
- Frontend UI changes — backend returns masked values, frontend just displays them

---

## Pending Scope Items to Present to User

All deferred improvements from previous tickets' "Out of Scope" sections that are relevant to this ticket have been presented to the user in the 01/02/03 documents above.

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/api/agents.js` | MODIFY | Mask sensitive fields in list response |
| `backend/src/api/credentials.js` | MODIFY | Mask encrypted values in list response |
| `backend/src/__tests__/agents.test.js` | MODIFY | Add masking tests |

---

## Acceptance Criteria

1. [ ] `GET /agents` does not return raw `api_key_hash` or `api_key_hash_prefix`
2. [ ] `GET /agents` returns masked versions (e.g., `"ak_xxx..."` → `"ak_***"`)
3. [ ] `GET /credentials` does not return raw `api_key_encrypted`
4. [ ] `GET /agents/:agentId/key` still works (key preview endpoint)
5. [ ] All existing agent tests still pass
6. [ ] `npm run test:coverage` passes (60% min threshold)

---

## Out of Scope

- Masking in WebSocket terminal proxy
- Masking in agent provider-config endpoint
- Frontend UI changes

---

## Performance Considerations

- Masking is a shallow object traversal — negligible overhead
- No new npm dependencies

---

## Testing Checklist

### Backend Tests
- [ ] Unit tests: verify agent list response masks sensitive fields
- [ ] Unit tests: verify credentials list response masks encrypted values
- [ ] **Coverage threshold (60%)**: `npm run test:coverage`

---

*Fill in all sections before starting implementation.*
