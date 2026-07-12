# 02_ARCHITECT_DESIGN.md — API Key Rotation and Expiry Design

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, `04_SPECIFICATION.md`

---

## Problem Statement

Agent API keys (stored in `project_agents.api_key`) never expire and cannot be rotated without deleting and recreating the agent. This is a security risk — if a key is compromised, it remains valid indefinitely. Keys should have an expiry date and support rotation with immediate invalidation of old keys.

---

## Current State

### Existing Backend
- `project_agents` table has `api_key` (VARCHAR) column — plaintext storage
- Agent auth middleware in `backend/src/middleware/auth.js` — validates `X-API-Key` header against plaintext `api_key`
- Mock keys: starts with `test-` or equals `mock-agent-key`
- No expiry tracking, no key hashing, no rotation API

### Gap Analysis
- No `api_key_expires_at` column — keys never expire
- No `api_key_hash` column — keys stored in plaintext
- No key rotation endpoint
- Auth middleware does not check expiry or use hash comparison

---

## Design

### Option A: Extend Existing Agent Structure (Recommended)

```
Database migration:
  backend/src/migrations/XXX_add_api_key_expiry_to_project_agents.sql
    → ALTER TABLE project_agents ADD COLUMN api_key_expires_at TIMESTAMP
    → ALTER TABLE project_agents ADD COLUMN api_key_hash VARCHAR(255)
    → Backfill: hash existing api_key values into api_key_hash
    → Rollback: DROP COLUMN api_key_expires_at, DROP COLUMN api_key_hash

AgentService changes:
  backend/src/services/AgentService.js
    → create(): hash new api_key with bcrypt, store in api_key_hash
    → create(): set api_key_expires_at = NOW() + INTERVAL '30 days'
    → generateApiKey(): new method to create random key + hash
    → rotateKey(agentId): generate new key, hash, update expires_at, invalidate old

AdminController changes:
  backend/src/controllers/adminController.js
    → rotateAgentKey(): POST /api/v1/admin/agents/:id/rotate-key
    → Generate new key, return plain text key to admin (one-time display)

Auth middleware changes:
  backend/src/middleware/auth.js
    → Check api_key_expires_at — reject if expired (401 KEY_EXPIRED)
    → Use bcrypt.compare() to compare input key against api_key_hash
    → Skip hash comparison for mock keys (test-*, mock-agent-key)
```

### Option B: Separate KeyManagementService
- Create `KeyManagementService.js` for key hashing/rotation
- More modular but overkill for this feature
- Would require new service injection pattern

### Option C: Key History Table
- Track all rotated keys in a separate table
- **Pros**: Audit trail, ability to revoke specific rotated keys
- **Cons**: More complex, out of scope for this ticket
- **Decision**: Skip key history table for now (deferred to bp-XX-key-history)

**Decision**: Option A — extend existing Agent structure. Minimal new files, follows existing patterns.

---

## Database Schema

### Migration: `XXX_add_api_key_expiry_to_project_agents.sql`

```sql
ALTER TABLE project_agents ADD COLUMN api_key_expires_at TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE project_agents ADD COLUMN api_key_hash VARCHAR(255);

-- Backfill existing keys
UPDATE project_agents SET api_key_hash = md5(api_key) WHERE api_key IS NOT NULL;

-- Set default expiry for existing keys (90 days from now to give time to rotate)
UPDATE project_agents SET api_key_expires_at = NOW() + INTERVAL '90 days' WHERE api_key_expires_at IS NULL;
```

### Rollback: `XXX_add_api_key_expiry_to_project_agents_rollback.sql`

```sql
ALTER TABLE project_agents DROP COLUMN IF EXISTS api_key_expires_at;
ALTER TABLE project_agents DROP COLUMN IF EXISTS api_key_hash;
```

### project_agents table (after migration)
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL | Primary key |
| project_id | INTEGER | FK to projects |
| agent_name | VARCHAR(255) | |
| api_key | VARCHAR(255) | Plaintext key (deprecated, use api_key_hash) |
| api_key_hash | VARCHAR(255) | bcrypt hash of current key |
| api_key_expires_at | TIMESTAMP | NULL = no expiry, set to 30 days on creation |
| created_at | TIMESTAMP | |

---

## API Design

### Key Rotation Endpoint
```
POST /api/v1/admin/agents/:id/rotate-key
Authorization: Bearer <token> (SUPER_ADMIN only)

Response:
{
  "success": true,
  "data": {
    "agentId": 5,
    "agentName": "deployment-bot",
    "newApiKey": "ak_new_abc123def456",
    "expiresAt": "2025-08-11T10:00:00.000Z",
    "message": "Key rotated. Store this key securely — it will not be shown again."
  }
}
```

### Expired Key Response
```
GET /api/v1/projects (with expired API key)

Response:
{
  "success": false,
  "error": {
    "code": "KEY_EXPIRED",
    "message": "API key expired on 2025-07-11T10:00:00.000Z. Contact admin to rotate.",
    "expiredAt": "2025-07-11T10:00:00.000Z"
  }
}
```

---

## Auth Middleware Changes

### Modified `auth.js`

```javascript
async function authenticateAgent(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: { code: 'MISSING_API_KEY', message: 'X-API-Key header required' }
    });
  }

  // Mock key bypass
  if (apiKey.startsWith('test-') || apiKey === 'mock-agent-key') {
    return next();
  }

  // Find agent by hashed key
  const agent = await pool.query(
    'SELECT * FROM project_agents WHERE api_key_hash = $1',
    [apiKey]  // Wait — bcrypt.compare needed, not direct comparison
  );

  // Actually: need to find by api_key_hash, then bcrypt.compare
  // But we can't index on bcrypt hash efficiently
  // Solution: store both api_key (plaintext) for lookup and api_key_hash for verification
  // OR: use a separate lookup table

  // Revised approach:
  // 1. Find agent by api_key (plaintext) — has index
  // 2. Check expiry on api_key_expires_at
  // 3. Verify with bcrypt.compare(apiKey, agent.api_key_hash)

  const result = await pool.query(
    'SELECT * FROM project_agents WHERE api_key = $1',
    [apiKey]
  );

  if (result.rows.length === 0) {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_API_KEY', message: 'Invalid API key' }
    });
  }

  const agent = result.rows[0];

  // Check expiry
  if (agent.api_key_expires_at && new Date(agent.api_key_expires_at) < new Date()) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'KEY_EXPIRED',
        message: `API key expired on ${agent.api_key_expires_at.toISOString()}`,
        expiredAt: agent.api_key_expires_at
      }
    });
  }

  // Verify hash
  const valid = await bcrypt.compare(apiKey, agent.api_key_hash);
  if (!valid) {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_API_KEY', message: 'Invalid API key' }
    });
  }

  req.agent = agent;
  next();
}
```

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Backend unit | Jest | `backend/src/__tests__/apiKeyRotation.test.js` | Key hashing, expiry check, rotation logic |
| API endpoint | Jest + supertest | `backend/src/__tests__/apiKeyRotationApi.test.js` | 401 on expired key, 200 on rotation |
| **Bash integration** | curl + helpers | `backend/integration-test/suites/api-key-rotation.test.sh` | Full rotation flow, expired key rejection |

### Test Cases

```javascript
// apiKeyRotation.test.js
describe('AgentService - API Key Rotation', () => {
  it('hashes api_key on agent creation', async () => {
    // Create agent
    // Assert api_key_hash is bcrypt hash
  });

  it('sets api_key_expires_at to 30 days from now', async () => {
    // Create agent
    // Assert expires_at is ~30 days in future
  });

  it('rotates key and invalidates old key', async () => {
    // Rotate key
    // Assert old key fails bcrypt comparison
    // Assert new key passes bcrypt comparison
  });

  it('rejects expired keys with KEY_EXPIRED error', async () => {
    // Stub agent with expired expires_at
    // Assert 401 with KEY_EXPIRED code
  });
});
```

---

## Risks and Edge Cases

### Backend Risks
- **[Migration performance]**: Hashing all existing keys during migration — Mitigation: Use md5 for backfill (fast), bcrypt for new keys. Consider batch processing for large datasets.
- **[Key lookup performance]**: Looking up by plaintext `api_key` vs hashed `api_key_hash` — Mitigation: Keep `api_key` column for lookup, use `api_key_hash` for verification
- **[Race condition on rotation]**: Concurrent rotation requests — Mitigation: Use transaction with row-level lock

### Edge Cases
- **[Mock keys]**: `test-*` and `mock-agent-key` should bypass expiry/hashing — Handle: Explicit bypass in auth middleware
- **[Existing agents]**: Existing agents need migration backfill — Handle: Backfill with md5 hash, set 90-day grace period
- **[Key format]**: Generated keys should be cryptographically random — Handle: Use `crypto.randomBytes(32).toString('hex')`
- **[Admin receives new key]**: New key returned in API response (one-time) — Handle: Document clearly in response message

---

## Alternative Designs Considered

### Alternative 1: Separate Key Table
- Store keys in separate `agent_api_keys` table with `is_current` flag
- **Pros**: Clean history, easy to revoke specific keys
- **Cons**: More complex queries, out of scope
- **Decision**: Keep single key column — simpler for now

### Alternative 2: JWT-Based Agent Auth
- Replace API keys with JWT tokens
- **Pros**: Built-in expiry, no database lookup
- **Cons**: Major auth overhaul, breaks existing integrations
- **Decision**: Extend API key system — minimal disruption

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
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-76-email-notifications | ☐ |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting | ☐ |
| 3 | N/A | N/A | N/A | N/A | ☐ |
| 4 | bp-07-structured-logging | Log file rotation (winston-daily-rotate-file) | Observability | bp-75-log-rotation | ☐ |

**If no deferred improvements are found, write: "No deferred improvements found in previous tickets."**

**All items above must be presented to the user before ticket approval.**

---

## Specification Generation

If a small model (7B–34B) will execute this ticket, the information above should be distilled into `04_SPECIFICATION.md` — a file that specifies exact file paths, imports, function signatures, test expectations, and edge cases. The small model should not need to make any architecture decisions; those are encoded in the Specification.

- [ ] `04_SPECIFICATION.md` has been created with exact file operations for each file
- [ ] Test expectations are specific (not "test it works" but "returns 401 with KEY_EXPIRED when key is expired")
- [ ] Edge cases are enumerated explicitly
- [ ] Imports and dependencies are listed per file
- [ ] **Pending scope items presented to user**: All deferred improvements from previous tickets have been listed above and presented to the user

---

*This design document guides implementation. The "Extend Existing Structure" section is the most important — it tells the agent exactly how to add to what already exists rather than creating new code from scratch.*
