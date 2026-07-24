# 03_ARCHITECT_IMPLEMENTATION.md — API Key Masking Implementation Plan

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `04_SPECIFICATION.md`

---

## Implementation Phases

### Phase 1: Mask agent list response

**MODIFY**: `backend/src/api/agents.js`

Add helper function after the imports:

```javascript
function maskAgentList(agents) {
  return agents.map(agent => {
    const masked = { ...agent };
    if (masked.api_key_hash) masked.api_key_hash = '***';
    if (masked.api_key_hash_prefix) masked.api_key_hash_prefix = '***';
    return masked;
  });
}
```

Update the `GET /agents` handler (line 87-95):

```javascript
router.get('/', verifyTokenOrAgent, requireAnyPermission('AGENT_READ'), async (req, res) => {
  try {
    const agents = await AgentService.list(req.user.userId);
    res.json({ agents: maskAgentList(agents) });
  } catch (error) {
    logger.error('GET /api/agents', error);
    res.status(500).json({ error: error.message });
  }
});
```

### Phase 2: Mask credentials list response

**MODIFY**: `backend/src/api/credentials.js`

Add similar helper and apply to list endpoint.

### Phase 3: Tests

**MODIFY**: `backend/src/__tests__/agents.test.js`

Add tests:
- `GET /agents` response does not contain raw `api_key_hash`
- `GET /agents` response does not contain raw `api_key_hash_prefix`
- `GET /agents/:agentId/key` still returns key preview

### Phase 4: Verify & Build

1. Run `cd backend && npm test` — verify tests pass
2. Run `cd backend && npm run test:coverage` — verify 60% coverage
3. Run `cd backend && npm run lint` — verify no lint errors

---

## Files Changed

```
backend/src/api/agents.js                → MODIFY (add maskAgentList, apply to GET /)
backend/src/api/credentials.js           → MODIFY (add maskCredentialsList, apply to GET /)
backend/src/__tests__/agents.test.js     → MODIFY (add masking tests)
```

---

### i) Code Review Checklist

- [ ] `maskAgentList` helper masks `api_key_hash` and `api_key_hash_prefix`
- [ ] `maskCredentialsList` helper masks `api_key_encrypted`
- [ ] `GET /agents/:agentId/key` still returns key preview (substring + ***)
- [ ] `POST /agents/create` still returns `generatedApiKey` (plaintext, intentional)
- [ ] All existing agent tests still pass
- [ ] `npm run test:coverage` passes (60% min threshold)
- [ ] **Coverage threshold enforced**: `npm run test:coverage` — min 60% lines, functions, branches, statements

### j) Post-Deploy Verification

1. [ ] Backend: `npm test` passes
2. [ ] Backend: `npm run test:coverage` passes (60% min threshold)
3. [ ] Backend: `npm run lint` passes
4. [ ] `GET /agents` returns masked keys
5. [ ] `GET /agents/:agentId/key` returns key preview
6. [ ] `docker compose up --build` starts without errors

---

*Fill in all sections before starting implementation.*
