# 04_SPECIFICATION.md — API Key Masking Execution Spec

**Use this file when a small model (7B–34B) will execute the ticket.**  
This file bridges the planning docs (01–03) and the code. It specifies exact file operations, imports, function signatures, test expectations, and edge cases.

**Generated from**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`
**Target model**: 34B local model
**Date**: 2025-07-24

---

## Test-First Requirement

**Test stub files MUST be created before any production code.**

The model MUST:
1. Create **empty test stub files** (with imports, `describe` blocks, and stub `it` blocks) for every test file listed in "Test Expectations" below
2. Create **production code files** (implementation + components)
3. Fill in the test stubs with actual assertions

---

## File Operations

### MODIFY: `backend/src/api/agents.js`

**Add helper function** after the imports (after line 22, before the OpenAPI annotations):

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

**Update `GET /agents` handler** (line 87-95):

Change:
```javascript
const agents = await AgentService.list(req.user.userId);
res.json({ agents });
```

To:
```javascript
const agents = await AgentService.list(req.user.userId);
res.json({ agents: maskAgentList(agents) });
```

### MODIFY: `backend/src/api/credentials.js`

**Add helper function** after the imports:

```javascript
function maskCredentialList(credentials) {
  return credentials.map(c => {
    const masked = { ...c };
    if (masked.api_key_encrypted) masked.api_key_encrypted = '***';
    return masked;
  });
}
```

**Update `GET /credentials` handler** — apply `maskCredentialList` to the list response.

### MODIFY: `backend/src/__tests__/agents.test.js`

**Add test cases** to verify masking:

```javascript
describe('Agent API - Key Masking', () => {
  it('GET /agents masks api_key_hash in response', async () => {
    // Create agent, GET /agents, verify api_key_hash is '***' not raw hash
  });

  it('GET /agents masks api_key_hash_prefix in response', async () => {
    // Verify api_key_hash_prefix is '***' not raw prefix
  });

  it('GET /agents/:agentId/key returns key preview', async () => {
    // Verify key preview endpoint still works with substring + ***
  });
});
```

---

## Test Expectations

### Backend Unit Tests — Agent API Masking
```
✓ [happy] GET /agents response does not contain raw api_key_hash
✓ [happy] GET /agents response does not contain raw api_key_hash_prefix
✓ [happy] GET /agents/:agentId/key returns key preview (substring 8 + ***)
✓ [happy] POST /agents/create still returns generatedApiKey (plaintext, intentional)
✓ [shape] Masked fields are the string '***' not null or empty
```

---

## Edge Cases to Handle

1. **[agent with no API key]**: `api_key_hash` is null — masking should not crash (check `if (masked.api_key_hash)` before masking)
2. **[agent with revoked key]**: Same as above — `api_key_hash` is null after revocation
3. **[GET /agents/:agentId/key]**: This endpoint intentionally returns `substring(0, 8) + '***'` — do NOT change this behavior
4. **[POST /agents/create]**: Returns `generatedApiKey` as plaintext — this is intentional (user needs the key once)

---

## Existing Code Patterns to Follow

- Backend uses CommonJS (`require`, `module.exports`)
- Response format: `{ agents }` or `{ agents: [...] }`
- Masking pattern: `if (field) field = '***'`
- Helper functions defined at module level

---

## Pending Scope Items

**All deferred improvements from previous tickets' "Out of Scope" sections that are relevant to this ticket have been presented to the user in the 01/02/03 documents above.**

---

## Files NOT to Change

- `backend/src/services/AgentService.js` — service-level operations need raw hashes
- `backend/src/api/terminal.js` — WebSocket auth needs raw hashes
- `frontend/` — frontend just displays what backend returns

---

*This specification is the contract between planning and execution.*
