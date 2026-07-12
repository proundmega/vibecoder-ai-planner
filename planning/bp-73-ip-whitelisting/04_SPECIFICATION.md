# 04_SPECIFICATION.md — IP Whitelisting Execution Spec

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

### CREATE: `backend/src/migrations/XXX_create_ip_whitelist_table.sql`

**Contents**:
```sql
CREATE TABLE ip_whitelist (
  id SERIAL PRIMARY KEY,
  ip_address VARCHAR(45) NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_ip_whitelist_ip_address ON ip_whitelist(ip_address);
```

### CREATE: `backend/src/migrations/XXX_create_ip_whitelist_table_rollback.sql`

**Contents**:
```sql
DROP TABLE IF EXISTS ip_whitelist;
```

**Note**: Replace `XXX` with the next available migration number. List `backend/src/migrations/` to find the highest number.

---

### CREATE: `backend/src/services/IpWhitelistService.js`

**Full file contents**:

```javascript
const { pool } = require('../db');
const AppError = require('../utils/AppError');

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
    const ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    const ipv6 = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
    return ipv4.test(ip) || ipv6.test(ip);
  }
}

module.exports = IpWhitelistService;
```

---

### MODIFY: `backend/src/controllers/adminController.js`

**Add imports** (add near top of file with other requires):
```javascript
const IpWhitelistService = require('../services/IpWhitelistService');
```

**Add methods** (add at end of adminController object, before module.exports):

```javascript
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
    if (!ip_address) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_IP', message: 'ip_address is required' }
      });
    }
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
    res.json({
      success: true,
      data: { ...result, message: 'IP removed from whitelist' }
    });
  } catch (error) {
    next(error);
  }
}
```

---

### MODIFY: `backend/src/api/v1/index.js`

**Add routes** (add after existing admin routes, before module.exports):

```javascript
// IP Whitelist routes
router.get('/admin/ip-whitelist', requireSuperAdmin, adminController.listIpWhitelist);
router.post('/admin/ip-whitelist', requireSuperAdmin, adminController.createIpWhitelist);
router.delete('/admin/ip-whitelist/:id', requireSuperAdmin, adminController.deleteIpWhitelist);
```

---

### MODIFY: `backend/src/middleware/rateLimiter.js`

**Add import** (add near top of file):
```javascript
const IpWhitelistService = require('../services/IpWhitelistService');
```

**Add whitelist check** at the beginning of the `authRateLimiter` function (before existing rate limit logic):

```javascript
async function authRateLimiter(req, res, next) {
  // Check whitelist first
  try {
    const isWhitelisted = await IpWhitelistService.isWhitelisted(req.ip);
    if (isWhitelisted) {
      return next();
    }
  } catch (error) {
    // If whitelist check fails, fall through to rate limiting (fail closed)
    console.error('IP whitelist check failed:', error.message);
  }

  // ... existing rate limit logic ...
}
```

**Same pattern** for `registerRateLimiter` and `authMeRateLimiter` if they exist as separate functions.

---

### CREATE: `backend/src/__tests__/ipWhitelist.test.js`

**Full file contents**:

```javascript
const IpWhitelistService = require('services/IpWhitelistService');
const { pool } = require('db');
const AppError = require('utils/AppError');

jest.mock('db', () => ({
  pool: { query: jest.fn() }
}));

describe('IpWhitelistService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists all whitelisted IPs', async () => {
    // TODO: implement
  });

  it('creates a whitelisted IP with validation', async () => {
    // TODO: implement
  });

  it('rejects invalid IP addresses', async () => {
    // TODO: implement
  });

  it('deletes a whitelisted IP', async () => {
    // TODO: implement
  });

  it('throws 404 when deleting non-existent IP', async () => {
    // TODO: implement
  });

  it('checks if IP is whitelisted', async () => {
    // TODO: implement
  });

  it('validates IPv4 addresses', async () => {
    // TODO: implement
  });

  it('validates IPv6 addresses', async () => {
    // TODO: implement
  });
});
```

---

### CREATE: `backend/src/__tests__/ipWhitelistApi.test.js`

**Full file contents**:

```javascript
const request = require('supertest');
const app = require('src/index');

describe('IP Whitelist API', () => {
  it('returns 403 for non-admin user', async () => {
    // TODO: implement
  });

  it('returns list for super admin', async () => {
    // TODO: implement
  });

  it('creates a whitelisted IP', async () => {
    // TODO: implement
  });

  it('rejects invalid IP on creation', async () => {
    // TODO: implement
  });

  it('deletes a whitelisted IP', async () => {
    // TODO: implement
  });
});
```

---

### CREATE: `backend/integration-test/suites/ip-whitelist.test.sh`

**Full file contents**:

```bash
#!/bin/bash
set -e

BASE_URL="${BASE_URL:-http://localhost:3001}"

echo "=== IP Whitelist Integration Test ==="

# 1. Get super admin token
echo "1. Authenticating as super admin..."

# 2. List whitelisted IPs
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

## Test Expectations

List every test case the model must create, organized by layer. Do not write "test it works" — each case must describe a specific input, expected output, and why it matters.

### Backend Unit Tests — IpWhitelistService
```
✓ [happy] list() returns all whitelisted IPs ordered by created_at DESC
✓ [happy] create() inserts IP and returns created row
✓ [error] create() throws INVALID_IP (400) for invalid IP like "not-an-ip"
✓ [edge] create() accepts IPv4 addresses (192.168.1.1)
✓ [edge] create() accepts IPv6 addresses (2001:0db8:85a3:0000:0000:8a2e:0370:7334)
✓ [happy] delete() removes IP and returns deleted row
✓ [error] delete() throws IP_NOT_FOUND (404) for non-existent ID
✓ [happy] isWhitelisted() returns true for whitelisted IP
✓ [happy] isWhitelisted() returns false for non-whitelisted IP
```

### Backend API Tests — Whitelist Endpoints
```
✓ [error] GET /api/v1/admin/ip-whitelist returns 403 for non-super-admin
✓ [happy] GET /api/v1/admin/ip-whitelist returns 200 with IP list for super admin
✓ [happy] POST /api/v1/admin/ip-whitelist returns 201 with created IP
✓ [error] POST /api/v1/admin/ip-whitelist returns 400 for invalid IP
✓ [error] POST /api/v1/admin/ip-whitelist returns 400 for missing ip_address
✓ [happy] DELETE /api/v1/admin/ip-whitelist/:id returns 200
```

### Backend Bash Integration Tests
```
✓ [flow] Full CRUD: list → create → verify → delete → verify gone
✓ [error] Non-whitelisted IP is rate limited
✓ [flow] Whitelisted IP bypasses rate limiting
```

---

## Edge Cases to Handle

1. **[Invalid IP format]**: User submits "not-an-ip" — Handle: validateIp() returns false, throw INVALID_IP (400)
2. **[Duplicate IP]**: User tries to add IP already in whitelist — Handle: UNIQUE constraint throws, catch and return 409 or 400
3. **[IPv6 addresses]**: IPv6 is longer than IPv4 — Handle: VARCHAR(45) covers full IPv6 with zone ID
4. **[CIDR notation]**: User submits "10.0.0.0/24" — Handle: validateIp() rejects (out of scope: CIDR support)
5. **[DB error on whitelist check]**: Rate limiter DB query fails — Handle: catch error, fall through to rate limiting (fail closed)

---

## Existing Code Patterns to Follow

- Use `pool.query()` with parameterized queries (no SQL injection)
- Error format: `{ success: false, error: { code, message } }`
- Admin endpoints require `requireSuperAdmin` middleware
- Services are in `backend/src/services/`
- Controllers are in `backend/src/controllers/`
- Routes mounted in `backend/src/api/v1/index.js`
- Tests use `jest.mock()` for database dependencies
- Jest setup: `moduleDirectories: ['node_modules', '<rootDir>']` + `moduleNameMapper`

---

## Pending Scope Items

**All deferred improvements from previous tickets' "Out of Scope" sections that are relevant to this ticket have been presented to the user in the 01/02/03 documents above.**

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-76-email-notifications | ☐ |
| 2 | N/A | N/A | N/A | N/A | ☐ |
| 3 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation | ☐ |
| 4 | bp-07-structured-logging | Log file rotation (winston-daily-rotate-file) | Observability | bp-75-log-rotation | ☐ |

**If no deferred improvements are found, write: "No deferred improvements found in previous tickets."**

---

## Files NOT to Change

- `frontend/src/views/Login.vue` — IP whitelisting is backend-only
- `frontend/src/api/client.js` — no frontend changes needed
- `backend/src/middleware/auth.js` — existing auth middleware unchanged
- `backend/src/models/` — no model changes needed (table created via migration)

---

*This specification is the contract between planning and execution. If the model cannot produce code matching this spec, it should request human feedback rather than guessing.*
