# 02_ARCHITECT_DESIGN.md — API Key Masking Design

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, `04_SPECIFICATION.md`

---

## Problem Statement

`GET /agents` returns raw DB rows including `api_key_hash` (bcrypt hash) and `api_key_hash_prefix` (SHA-256 prefix). While these aren't plaintext API keys, exposing internal hash values is unnecessary and leaks implementation details.

---

## Design

### Option A: Mask in Controller (Recommended)

Add a `maskAgentList()` helper in `agents.js` that maps over results before returning:

```javascript
function maskAgentList(agents) {
  return agents.map(agent => {
    const masked = { ...agent };
    if (masked.api_key_hash) {
      masked.api_key_hash = '***';
    }
    if (masked.api_key_hash_prefix) {
      masked.api_key_hash_prefix = '***';
    }
    return masked;
  });
}

// In GET /agents handler:
const agents = await AgentService.list(req.user.userId);
res.json({ agents: maskAgentList(agents) });
```

### Option B: Mask at Service Level

Move masking into `AgentService.list()` so all callers benefit.

**Pros**: DRY — one place, all callers get masked data.
**Cons**: `getAgentByApiKey()` and `getProviderConfig()` need the raw hash for verification.

**Decision**: Option A (controller-level) — only the list endpoint should mask. Other endpoints need raw hashes.

### Option C: Use DB-level column exclusion

```sql
SELECT id, name, created_at FROM agents WHERE owner_id = $1
-- Exclude api_key_hash, api_key_hash_prefix at SQL level
```

**Pros**: Cleanest — data never leaves DB.
**Cons**: Need to update SELECT list everywhere, easy to forget.

**Decision**: Option A — simpler, less error-prone, explicit about what's masked.

---

## Credential Masking

Same pattern for credentials:

```javascript
function maskCredentialList(credentials) {
  return credentials.map(c => {
    const masked = { ...c };
    if (masked.api_key_encrypted) {
      masked.api_key_encrypted = '***';
    }
    return masked;
  });
}
```

---

## Risks and Edge Cases

- **[api_key returned on creation]**: The `POST /agents/create` endpoint returns the plaintext `generatedApiKey`. This is intentional — user needs the key once at creation. Masking only applies to list/read endpoints.
- **[api_key_hash needed for auth]**: `getAgentByApiKey()` uses `api_key_hash` for bcrypt comparison. Controller-level masking preserves raw values for service-level operations.
- **[api_key_hash_prefix needed for lookup]**: `getAgentByApiKey()` uses `api_key_hash_prefix` for prefix-based lookup. Same as above — controller masking preserves raw values.

---

## Alternative Designs Considered

### Alternative 1: DB-level column exclusion
- **Pros**: Cleanest, data never leaves DB
- **Cons**: Need to update every SELECT query, easy to forget in new endpoints
- **Decision**: Option A is safer — explicit masking in controllers

### Alternative 2: Service-level masking
- **Pros**: DRY, all callers benefit
- **Cons**: Breaks endpoints that need raw hashes (auth lookup)
- **Decision**: Option A is more targeted

---

## Specification Generation

- [ ] `04_SPECIFICATION.md` has been created with exact file operations
- [ ] Test expectations are specific
- [ ] Edge cases are enumerated explicitly
- [ ] Pending scope items presented to user

---

*This design document guides implementation.*
