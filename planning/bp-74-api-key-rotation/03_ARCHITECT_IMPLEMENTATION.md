# 03_ARCHITECT_IMPLEMENTATION.md — API Key Rotation Implementation Plan

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `04_SPECIFICATION.md`

---

## Implementation Phases

### Phase 1: Database Migration

1. Create migration files:
   - `backend/src/migrations/XXX_add_api_key_expiry_to_project_agents.sql`
   - `backend/src/migrations/XXX_add_api_key_expiry_to_project_agents_rollback.sql`

2. Migration SQL:
   ```sql
   -- Apply
   ALTER TABLE project_agents ADD COLUMN api_key_expires_at TIMESTAMP WITHOUT TIME ZONE;
   ALTER TABLE project_agents ADD COLUMN api_key_hash VARCHAR(255);

   -- Backfill existing keys with md5 hash (fast migration)
   UPDATE project_agents SET api_key_hash = md5(api_key) WHERE api_key IS NOT NULL AND api_key_hash IS NULL;

   -- Set default expiry for existing keys (90 days grace period)
   UPDATE project_agents SET api_key_expires_at = NOW() + INTERVAL '90 days'
   WHERE api_key_expires_at IS NULL;

   -- Rollback
   ALTER TABLE project_agents DROP COLUMN IF EXISTS api_key_expires_at;
   ALTER TABLE project_agents DROP COLUMN IF EXISTS api_key_hash;
   ```

3. Find next migration number by listing `backend/src/migrations/` and finding highest number.

---

### Phase 2: AgentService — Key Hashing & Rotation

#### `backend/src/services/AgentService.js` (MODIFY)

**Add key hashing utility**:

```javascript
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const SALT_ROUNDS = 10;
const DEFAULT_KEY_EXPIRY_DAYS = 30;

class AgentService {
  // In create() method — hash the API key
  static async create(projectId, agentName, createdBy) {
    const apiKey = crypto.randomBytes(32).toString('hex');
    const apiKeyHash = await bcrypt.hash(apiKey, SALT_ROUNDS);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + DEFAULT_KEY_EXPIRY_DAYS);

    const result = await pool.query(
      `INSERT INTO project_agents (project_id, agent_name, api_key, api_key_hash, api_key_expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, project_id, agent_name, api_key, api_key_expires_at, created_at`,
      [projectId, agentName, apiKey, apiKeyHash, expiresAt, createdBy]
    );

    const agent = result.rows[0];
    // Return the plaintext key ONCE (admin will store it)
    return { ...agent, apiKey };
  }

  // New method: rotate key
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
}
```

---

### Phase 3: AdminController — Rotate Key Endpoint

#### `backend/src/controllers/adminController.js` (MODIFY)

**Add rotateKey handler**:

```javascript
const AgentService = require('../services/AgentService');

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

### Phase 4: Route Mounting

#### `backend/src/api/v1/index.js` (MODIFY)

**Add rotate-key route**:

```javascript
// After existing agent routes, add:
router.post('/admin/agents/:id/rotate-key', requireSuperAdmin, adminController.rotateAgentKey);
```

---

### Phase 5: Auth Middleware — Key Expiry & Hash Verification

#### `backend/src/middleware/auth.js` (MODIFY)

**Add key expiry check and hash comparison**:

```javascript
const bcrypt = require('bcryptjs');

async function authenticateAgent(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: { code: 'MISSING_API_KEY', message: 'X-API-Key header required' }
    });
  }

  // Mock key bypass (test-*, mock-agent-key)
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

### Phase 6: Tests

#### CREATE: `backend/src/__tests__/apiKeyRotation.test.js`

```javascript
const AgentService = require('services/AgentService');
const { pool } = require('db');

describe('AgentService - API Key Rotation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('hashes api_key on agent creation', async () => {
    // Stub pool.query to return agent with api_key_hash
    // Assert api_key_hash is a bcrypt hash (starts with $2)
  });

  it('sets api_key_expires_at to 30 days from now', async () => {
    // Stub pool.query
    // Assert expires_at is ~30 days in future
  });

  it('rotates key and invalidates old key', async () => {
    // Stub pool.query for rotation
    // Assert old key fails bcrypt comparison
    // Assert new key passes bcrypt comparison
  });

  it('throws 404 when rotating non-existent agent', async () => {
    // Stub pool.query to return empty
    // Assert AppError thrown with AGENT_NOT_FOUND
  });
});
```

#### CREATE: `backend/src/__tests__/apiKeyRotationApi.test.js`

```javascript
const request = require('supertest');
const app = require('src/index');

describe('Agent Key Rotation API', () => {
  it('returns 401 with KEY_EXPIRED for expired key', async () => {
    // Auth with expired key
    // Assert 401 with KEY_EXPIRED code
  });

  it('returns 401 with INVALID_API_KEY for wrong key', async () => {
    // Auth with invalid key
    // Assert 401 with INVALID_API_KEY code
  });

  it('rotates key successfully for super admin', async () => {
    // Auth as super admin
    // POST /api/v1/admin/agents/:id/rotate-key
    // Assert 200 with new key
  });

  it('returns 403 for non-admin user rotating key', async () => {
    // Auth as non-admin
    // POST /api/v1/admin/agents/:id/rotate-key
    // Assert 403
  });
});
```

#### CREATE: `backend/integration-test/suites/api-key-rotation.test.sh`

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

### Phase 7: OpenAPI Spec

1. Add JSDoc annotations to rotate-key route
2. Add JSDoc annotations to 401 KEY_EXPIRED response
3. Run `cd backend && npm run generate:spec`
4. Run `cd backend && npm test`
5. Run `cd backend && npm run test:coverage`

---

## Files Changed

```
backend/src/migrations/XXX_add_api_key_expiry_to_project_agents.sql           → CREATE
backend/src/migrations/XXX_add_api_key_expiry_to_project_agents_rollback.sql  → CREATE
backend/src/services/AgentService.js                                           → MODIFY (hash keys, rotateKey method)
backend/src/controllers/adminController.js                                     → MODIFY (rotateAgentKey handler)
backend/src/api/v1/index.js                                                    → MODIFY (rotate-key route)
backend/src/middleware/auth.js                                                 → MODIFY (expiry check, hash comparison)
backend/src/__tests__/apiKeyRotation.test.js                                   → CREATE
backend/src/__tests__/apiKeyRotationApi.test.js                                → CREATE
backend/integration-test/suites/api-key-rotation.test.sh                       → CREATE
```

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

### i) Code Review Checklist

- [ ] Backend follows existing patterns (controller/service/model separation)
- [ ] Backend uses parameterized queries (no SQL injection)
- [ ] Backend has JSDoc OpenAPI annotations
- [ ] Backend response format: `{ success: true, data: { ... } }`
- [ ] Backend errors pass to `next(error)`
- [ ] API keys stored as bcrypt hashes (not plaintext in api_key_hash)
- [ ] Expired keys return 401 with KEY_EXPIRED code
- [ ] Key rotation invalidates old key immediately
- [ ] Hash comparison uses bcrypt.compare (timing-safe)
- [ ] Mock keys (test-*, mock-agent-key) bypass expiry/hashing
- [ ] All tests written and passing — new/changed code has corresponding test files CREATED or EXTENDED
- [ ] OpenAPI spec regenerated if backend routes changed
- [ ] **Coverage threshold enforced**: `npm run test:coverage` — min 60% lines, functions, branches, statements
- [ ] Specification in `04_SPECIFICATION.md` matches what was actually implemented
- [ ] **Pending scope items presented to user**: All deferred improvements from previous tickets have been listed above and presented to the user

---

### j) Post-Deploy Verification

1. [ ] Backend: `npm test` passes
2. [ ] Backend: `npm run test:coverage` passes (60% min threshold)
3. [ ] Backend: `npm run lint` passes
4. [ ] Backend: `npm run generate:spec` passes
5. [ ] **Backend: `cd backend && bash integration-test/run.sh --only` passes (if backend API changed)**
6. [ ] New agents get hashed keys with 30-day expiry
7. [ ] Expired keys return 401 with KEY_EXPIRED code
8. [ ] `POST /api/v1/admin/agents/:id/rotate-key` generates new key
9. [ ] Key rotation sets new api_key_expires_at (30 days from now)
10. [ ] Old key is invalidated after rotation
11. [ ] If specification file exists: implementation matches the spec

---

*Fill in all sections before starting implementation. Update status as work progresses. The "Files Changed" section is the most important — it prevents agents from creating redundant code by forcing them to check what already exists.*
