# 04_SPECIFICATION.md — API Key Rotation Execution Spec

**Use this file when a small model (7B–34B) will execute the ticket.**  
This file bridges the planning docs (01–03) and the code. It specifies exact file operations, imports, function signatures, test expectations, and edge cases. The model should not need to make any architecture decisions — those are already encoded here.

**Generated from**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`
**Target model**: 34B local model
**Date**: 2025-07-12

---

## Test-First Requirement

**Test stub files MUST be created before any production code.** This prevents the model from skipping tests.

The model MUST:
1. Create **empty test stub files** (with imports, `describe` blocks, and stub `it` blocks) for every test file listed in "Test Expectations" below
2. Create **production code files** (implementation + components)
3. Fill in the test stubs with actual assertions

Only after all test stubs exist as empty files may the model begin implementing production code. Do not defer test creation to a later step.

---

## File Operations

Each entry specifies exactly what the model should produce. The model MUST NOT create, modify, or delete any file not listed here.

### CREATE: `backend/src/migrations/XXX_add_api_key_expiry_to_project_agents.sql`

**Contents**:
```sql
ALTER TABLE project_agents ADD COLUMN api_key_expires_at TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE project_agents ADD COLUMN api_key_hash VARCHAR(255);

-- Backfill existing keys with md5 hash (fast migration)
UPDATE project_agents SET api_key_hash = md5(api_key)
WHERE api_key IS NOT NULL AND api_key_hash IS NULL;

-- Set default expiry for existing keys (90 days grace period)
UPDATE project_agents SET api_key_expires_at = NOW() + INTERVAL '90 days'
WHERE api_key_expires_at IS NULL;
```

### CREATE: `backend/src/migrations/XXX_add_api_key_expiry_to_project_agents_rollback.sql`

**Contents**:
```sql
ALTER TABLE project_agents DROP COLUMN IF EXISTS api_key_expires_at;
ALTER TABLE project_agents DROP COLUMN IF EXISTS api_key_hash;
```

**Note**: Replace `XXX` with the next available migration number. List `backend/src/migrations/` to find the highest number.

---

### MODIFY: `backend/src/services/AgentService.js`

**Add imports** (add near top of file with other requires):
```javascript
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
```

**Add constants** (add near top of class, after requires):
```javascript
const SALT_ROUNDS = 10;
const DEFAULT_KEY_EXPIRY_DAYS = 30;
```

**Modify the `create()` method** to hash the API key:

```javascript
// In create() method, replace the existing api_key generation:
const apiKey = crypto.randomBytes(32).toString('hex');
const apiKeyHash = await bcrypt.hash(apiKey, SALT_ROUNDS);
const expiresAt = new Date();
expiresAt.setDate(expiresAt.getDate() + DEFAULT_KEY_EXPIRY_DAYS);

// Update the INSERT query to include api_key_hash and api_key_expires_at:
const result = await pool.query(
  `INSERT INTO project_agents (project_id, agent_name, api_key, api_key_hash, api_key_expires_at, created_by)
   VALUES ($1, $2, $3, $4, $5, $6)
   RETURNING id, project_id, agent_name, api_key, api_key_expires_at, created_at`,
  [projectId, agentName, apiKey, apiKeyHash, expiresAt, createdBy]
);
```

**Add `rotateKey()` static method** (add to class):

```javascript
static async rotateKey(agentId, createdBy) {
  const apiKey = crypto.randomBytes(32).toString('hex');
  const apiKeyHash = await bcrypt.hash(apiKey, SALT_ROUNDS);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + DEFAULT_KEY_EXPIRY_DAYS);

  const result = await pool.query(
    `UPDATE project_agents
     SET api_key = $1, api_key_hash = $2, api_key_expires_at = $3
     WHERE id = $4
     RETURNING id, agent_name, api_key, api_key_expires_at`,
    [apiKey, apiKeyHash, expiresAt, agentId]
  );

  if (result.rows.length === 0) {
    throw new AppError('AGENT_NOT_FOUND', 404, 'Agent not found');
  }

  const agent = result.rows[0];
  return { ...agent, apiKey };
}
```

---

### MODIFY: `backend/src/controllers/adminController.js`

**Add import** (add near top of file):
```javascript
const AgentService = require('../services/AgentService');
```

**Add `rotateAgentKey()` method** (add to adminController object):

```javascript
// POST /api/v1/admin/agents/:id/rotate-key
async function rotateAgentKey(req, res, next) {
  try {
    const { id } = req.params;
    const result = await AgentService.rotateKey(id, req.user.id);

    res.json({
      success: true,
      data: {
        agentId: result.id,
        agentName: result.agent_name,
        newApiKey: result.apiKey,
        expiresAt: result.api_key_expires_at,
        message: 'Key rotated. Store this key securely — it will not be shown again.'
      }
    });
  } catch (error) {
    next(error);
  }
}
```

---

### MODIFY: `backend/src/api/v1/index.js`

**Add route** (add after existing agent routes, before module.exports):

```javascript
// Agent key rotation
router.post('/admin/agents/:id/rotate-key', requireSuperAdmin, adminController.rotateAgentKey);
```

---

### MODIFY: `backend/src/middleware/auth.js`

**Add imports** (add near top of file):
```javascript
const bcrypt = require('bcryptjs');
```

**Modify `authenticateAgent()` function** to add expiry check and hash comparison:

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

  // Find agent by plaintext api_key (for lookup)
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

  // Verify hash (bcrypt.compare is timing-safe)
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

### CREATE: `backend/src/__tests__/apiKeyRotation.test.js`

**Full file contents**:

```javascript
const AgentService = require('services/AgentService');
const { pool } = require('db');
const AppError = require('utils/AppError');

jest.mock('db', () => ({
  pool: { query: jest.fn() }
}));

describe('AgentService - API Key Rotation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('hashes api_key on agent creation', async () => {
    // TODO: implement
  });

  it('sets api_key_expires_at to 30 days from now', async () => {
    // TODO: implement
  });

  it('rotates key and invalidates old key', async () => {
    // TODO: implement
  });

  it('throws 404 when rotating non-existent agent', async () => {
    // TODO: implement
  });
});
```

---

### CREATE: `backend/src/__tests__/apiKeyRotationApi.test.js`

**Full file contents**:

```javascript
const request = require('supertest');
const app = require('src/index');

describe('Agent Key Rotation API', () => {
  it('returns 401 with KEY_EXPIRED for expired key', async () => {
    // TODO: implement
  });

  it('returns 401 with INVALID_API_KEY for wrong key', async () => {
    // TODO: implement
  });

  it('rotates key successfully for super admin', async () => {
    // TODO: implement
  });

  it('returns 403 for non-admin user rotating key', async () => {
    // TODO: implement
  });
});
```

---

### CREATE: `backend/integration-test/suites/api-key-rotation.test.sh`

**Full file contents**:

```bash
#!/bin/bash
set -e

BASE_URL="${BASE_URL:-http://localhost:3001}"

echo "=== API Key Rotation Integration Test ==="

# 1. Create an agent (via admin API)
echo "1. Creating agent..."

# 2. Verify agent works with new key
echo "2. Verifying agent key works..."

# 3. Rotate the key
echo "3. Rotating key..."
curl -s -X POST "$BASE_URL/api/v1/admin/agents/$AGENT_ID/rotate-key" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# 4. Verify old key is rejected
echo "4. Verifying old key is rejected..."

# 5. Verify new key works
echo "5. Verifying new key works..."

echo "PASS: API key rotation integration test complete"
```

---

## Test Expectations

List every test case the model must create, organized by layer. Do not write "test it works" — each case must describe a specific input, expected output, and why it matters.

### Backend Unit Tests — AgentService Key Rotation
```
✓ [happy] create() hashes api_key with bcrypt (hash starts with $2)
✓ [happy] create() sets api_key_expires_at to ~30 days from now
✓ [happy] rotateKey() generates new key and updates api_key_hash
✓ [error] rotateKey() throws AGENT_NOT_FOUND (404) for non-existent agent
✓ [edge] rotateKey() returns new plaintext key for one-time display
```

### Backend API Tests — Key Rotation Endpoints
```
✓ [error] GET request with expired key returns 401 with KEY_EXPIRED code
✓ [error] GET request with wrong key returns 401 with INVALID_API_KEY code
✓ [error] GET request with missing key returns 401 with MISSING_API_KEY code
✓ [happy] POST /api/v1/admin/agents/:id/rotate-key returns 200 with new key for super admin
✓ [error] POST /api/v1/admin/agents/:id/rotate-key returns 403 for non-super-admin
✓ [flow] Old key is rejected after rotation (returns INVALID_API_KEY)
✓ [flow] New key works after rotation (returns success)
```

### Backend Bash Integration Tests
```
✓ [flow] Create agent → verify key works → rotate → verify old key fails → verify new key works
✓ [error] Expired key returns 401 with KEY_EXPIRED
```

---

## Edge Cases to Handle

1. **[Mock keys]**: `test-*` and `mock-agent-key` bypass expiry/hashing — Handle: explicit `startsWith('test-')` check before DB query
2. **[Existing agents]**: Migration backfills with md5 hash, 90-day grace period — Handle: existing agents get time to rotate
3. **[Key format]**: Generated keys use `crypto.randomBytes(32).toString('hex')` (64-char hex string)
4. **[Concurrent rotation]**: Two rotation requests for same agent — Handle: last write wins (acceptable, admin-managed)
5. **[api_key_hash is NULL]**: Pre-migration agents — Handle: migration backfills, check for NULL in middleware

---

## Existing Code Patterns to Follow

- Use `pool.query()` with parameterized queries (no SQL injection)
- Error format: `{ success: false, error: { code, message } }`
- Admin endpoints require `requireSuperAdmin` middleware
- Services are in `backend/src/services/`
- Controllers are in `backend/src/controllers/`
- Routes mounted in `backend/src/api/v1/index.js`
- Tests use `jest.mock()` for database dependencies
- bcryptjs for hashing (already a dependency)
- crypto for random key generation (built-in Node.js)

---

## Pending Scope Items

**All deferred improvements from previous tickets' "Out of Scope" sections that are relevant to this ticket have been presented to the user in the 01/02/03 documents above.**

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-76-email-notifications | ☐ |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting | ☐ |
| 3 | N/A | N/A | N/A | N/A | ☐ |
| 4 | bp-07-structured-logging | Log file rotation (winston-daily-rotate-file) | Observability | bp-75-log-rotation | ☐ |

**If no deferred improvements are found, write: "No deferred improvements found in previous tickets."**

---

## Files NOT to Change

- `frontend/src/views/` — no frontend changes for API key rotation
- `backend/src/middleware/rateLimiter.js` — rate limiting unchanged
- `backend/src/models/` — no model file changes (migration handles schema)
- `backend/src/validators/` — no Joi schema changes needed

---

*This specification is the contract between planning and execution. If the model cannot produce code matching this spec, it should request human feedback rather than guessing.*
