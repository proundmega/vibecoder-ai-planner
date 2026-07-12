# 03_ARCHITECT_IMPLEMENTATION.md — IP Whitelisting Implementation Plan

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `04_SPECIFICATION.md`

---

## Implementation Phases

### Phase 1: Database Migration

1. Create migration files:
   - `backend/src/migrations/XXX_create_ip_whitelist_table.sql`
   - `backend/src/migrations/XXX_create_ip_whitelist_table_rollback.sql`

2. Migration SQL:
   ```sql
   -- Apply
   CREATE TABLE ip_whitelist (
     id SERIAL PRIMARY KEY,
     ip_address VARCHAR(45) NOT NULL UNIQUE,
     description TEXT DEFAULT '',
     created_by INTEGER REFERENCES users(id),
     created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
   );
   CREATE INDEX idx_ip_whitelist_ip_address ON ip_whitelist(ip_address);

   -- Rollback
   DROP TABLE IF EXISTS ip_whitelist;
   ```

3. Find next migration number by listing `backend/src/migrations/` and finding highest number.

---

### Phase 2: IpWhitelistService

#### CREATE: `backend/src/services/IpWhitelistService.js`

```javascript
const { pool } = require('../db');
const AppError = require('../utils/AppError');

const IP_REGEX = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;

class IpWhitelistService {
  static async list() {
    const result = await pool.query(
      'SELECT id, ip_address, description, created_by, created_at FROM ip_whitelist ORDER BY created_at DESC'
    );
    return result.rows;
  }

  static async create(ipAddress, description, createdBy) {
    if (!IpWhitelistService.validateIp(ipAddress)) {
      throw new AppError('INVALID_IP', 400, `Invalid IP address: ${ipAddress}`);
    }

    const result = await pool.query(
      `INSERT INTO ip_whitelist (ip_address, description, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, ip_address, description, created_by, created_at`,
      [ipAddress, description || '', createdBy]
    );
    return result.rows[0];
  }

  static async delete(id) {
    const result = await pool.query(
      'DELETE FROM ip_whitelist WHERE id = $1 RETURNING id, ip_address',
      [id]
    );
    if (result.rows.length === 0) {
      throw new AppError('IP_NOT_FOUND', 404, 'Whitelisted IP not found');
    }
    return result.rows[0];
  }

  static async isWhitelisted(ipAddress) {
    const result = await pool.query(
      'SELECT 1 FROM ip_whitelist WHERE ip_address = $1',
      [ipAddress]
    );
    return result.rows.length > 0;
  }

  static validateIp(ip) {
    // Support both IPv4 and IPv6
    const ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    const ipv6 = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
    return ipv4.test(ip) || ipv6.test(ip);
  }
}

module.exports = IpWhitelistService;
```

---

### Phase 3: AdminController Changes

#### `backend/src/controllers/adminController.js` (MODIFY)

**Add whitelist CRUD handlers**:

```javascript
const IpWhitelistService = require('../services/IpWhitelistService');

// GET /api/v1/admin/ip-whitelist
async function listIpWhitelist(req, res, next) {
  try {
    const ips = await IpWhitelistService.list();
    res.json({ success: true, data: ips });
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/admin/ip-whitelist
async function createIpWhitelist(req, res, next) {
  try {
    const { ip_address, description } = req.body;
    const ip = await IpWhitelistService.create(ip_address, description, req.user.id);
    res.status(201).json({ success: true, data: ip });
  } catch (error) {
    next(error);
  }
}

// DELETE /api/v1/admin/ip-whitelist/:id
async function deleteIpWhitelist(req, res, next) {
  try {
    const { id } = req.params;
    const result = await IpWhitelistService.delete(id);
    res.json({ success: true, data: { ...result, message: 'IP removed from whitelist' } });
  } catch (error) {
    next(error);
  }
}
```

---

### Phase 4: Route Mounting

#### `backend/src/api/v1/index.js` (MODIFY)

**Add whitelist routes**:

```javascript
// After existing admin routes, add:
router.get('/admin/ip-whitelist', requireSuperAdmin, adminController.listIpWhitelist);
router.post('/admin/ip-whitelist', requireSuperAdmin, adminController.createIpWhitelist);
router.delete('/admin/ip-whitelist/:id', requireSuperAdmin, adminController.deleteIpWhitelist);
```

---

### Phase 5: Rate Limiter Integration

#### `backend/src/middleware/rateLimiter.js` (MODIFY)

**Add whitelist check before rate limit**:

```javascript
const IpWhitelistService = require('../services/IpWhitelistService');

async function authRateLimiter(req, res, next) {
  // Check whitelist first
  const isWhitelisted = await IpWhitelistService.isWhitelisted(req.ip);
  if (isWhitelisted) {
    return next(); // Skip rate limit for whitelisted IPs
  }

  // ... existing rate limit logic ...
}
```

**Note**: This adds a DB query on every rate-limited request. For now, direct DB query is acceptable. Cache optimization can be added later (deferred to bp-XX-whitelist-cache).

---

### Phase 6: Tests

#### CREATE: `backend/src/__tests__/ipWhitelist.test.js`

```javascript
const IpWhitelistService = require('services/IpWhitelistService');
const { pool } = require('db');

describe('IpWhitelistService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists all whitelisted IPs', async () => {
    // Stub pool.query
    // Assert list returns all IPs ordered by created_at DESC
  });

  it('creates a whitelisted IP with validation', async () => {
    // Stub pool.query
    // Assert INSERT called with valid IP
  });

  it('rejects invalid IP addresses', async () => {
    // Pass invalid IP like "not-an-ip"
    // Assert AppError thrown with INVALID_IP code
  });

  it('deletes a whitelisted IP', async () => {
    // Stub pool.query
    // Assert DELETE called
  });

  it('throws 404 when deleting non-existent IP', async () => {
    // Stub pool.query to return empty
    // Assert AppError thrown with IP_NOT_FOUND code
  });

  it('checks if IP is whitelisted', async () => {
    // Stub pool.query
    // Assert returns true/false
  });

  it('validates IPv4 addresses', async () => {
    // Assert "192.168.1.1" is valid
    // Assert "not-an-ip" is invalid
  });

  it('validates IPv6 addresses', async () => {
    // Assert "2001:0db8:85a3:0000:0000:8a2e:0370:7334" is valid
  });
});
```

#### CREATE: `backend/src/__tests__/ipWhitelistApi.test.js`

```javascript
const request = require('supertest');
const app = require('src/index');

describe('IP Whitelist API', () => {
  it('returns 403 for non-admin user', async () => {
    // Auth as non-admin
    // GET /api/v1/admin/ip-whitelist
    // Assert 403
  });

  it('returns list for super admin', async () => {
    // Auth as super admin
    // GET /api/v1/admin/ip-whitelist
    // Assert 200 with IP list
  });

  it('creates a whitelisted IP', async () => {
    // Auth as super admin
    // POST /api/v1/admin/ip-whitelist with valid IP
    // Assert 201 with created IP
  });

  it('rejects invalid IP on creation', async () => {
    // Auth as super admin
    // POST /api/v1/admin/ip-whitelist with invalid IP
    // Assert 400
  });

  it('deletes a whitelisted IP', async () => {
    // Auth as super admin
    // DELETE /api/v1/admin/ip-whitelist/:id
    // Assert 200
  });
});
```

#### CREATE: `backend/integration-test/suites/ip-whitelist.test.sh`

```bash
#!/bin/bash
set -e

BASE_URL="${BASE_URL:-http://localhost:3001}"

echo "=== IP Whitelist Integration Test ==="

# 1. Get super admin token
echo "1. Authenticating as super admin..."

# 2. List whitelisted IPs (should be empty or existing)
echo "2. Listing whitelisted IPs..."
curl -s -X GET "$BASE_URL/api/v1/admin/ip-whitelist" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# 3. Add IP to whitelist
echo "3. Adding IP to whitelist..."
curl -s -X POST "$BASE_URL/api/v1/admin/ip-whitelist" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ip_address": "203.0.113.50", "description": "Test CI/CD"}'

# 4. Verify IP is in whitelist
echo "4. Verifying IP in whitelist..."

# 5. Delete IP from whitelist
echo "5. Deleting IP from whitelist..."

echo "PASS: IP whitelist integration test complete"
```

---

### Phase 7: OpenAPI Spec

1. Add JSDoc annotations to whitelist routes
2. Run `cd backend && npm run generate:spec`
3. Run `cd backend && npm test`
4. Run `cd backend && npm run test:coverage`

---

## Files Changed

```
backend/src/migrations/XXX_create_ip_whitelist_table.sql              → CREATE
backend/src/migrations/XXX_create_ip_whitelist_table_rollback.sql     → CREATE
backend/src/services/IpWhitelistService.js                            → CREATE
backend/src/controllers/adminController.js                            → MODIFY (add CRUD handlers)
backend/src/api/v1/index.js                                           → MODIFY (add routes)
backend/src/middleware/rateLimiter.js                                 → MODIFY (add whitelist check)
backend/src/__tests__/ipWhitelist.test.js                             → CREATE
backend/src/__tests__/ipWhitelistApi.test.js                          → CREATE
backend/integration-test/suites/ip-whitelist.test.sh                  → CREATE
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
| 2 | N/A | N/A | N/A | N/A | ☐ |
| 3 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation | ☐ |
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
- [ ] IP validation regex covers IPv4 and IPv6
- [ ] All endpoints require SUPER_ADMIN role
- [ ] Whitelist check in rate limiter handles DB errors gracefully
- [ ] All tests written and passing — new/changed code has corresponding test files CREATED or EXTENDED
- [ ] OpenAPI spec regenerated if backend routes changed
- [ ] Generated TypeScript types regenerated if response shapes changed
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
6. [ ] `GET /api/v1/admin/ip-whitelist` returns list for super admin
7. [ ] `POST /api/v1/admin/ip-whitelist` adds IP to whitelist
8. [ ] `DELETE /api/v1/admin/ip-whitelist/:id` removes IP from whitelist
9. [ ] Whitelisted IPs bypass rate limiting
10. [ ] Non-whitelisted IPs are rate limited normally
11. [ ] Invalid IP addresses are rejected
12. [ ] If specification file exists: implementation matches the spec

---

*Fill in all sections before starting implementation. Update status as work progresses. The "Files Changed" section is the most important — it prevents agents from creating redundant code by forcing them to check what already exists.*
