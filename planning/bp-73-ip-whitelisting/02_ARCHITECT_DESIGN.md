# 02_ARCHITECT_DESIGN.md — IP Whitelisting for Rate Limit Exceptions Design

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, `04_SPECIFICATION.md`

---

## Problem Statement

IP whitelisting allows administrators to exempt specific IP addresses from rate limiting. This is needed for CI/CD pipelines, internal monitoring tools, and trusted partner integrations that make automated API calls. Currently, all IPs are subject to the same rate limits with no exceptions.

---

## Current State

### Existing Backend
- `AuthRateLimiter` middleware in `backend/src/middleware/rateLimiter.js` — checks `req.ip` against a store
- Admin routes in `backend/src/api/v1/index.js` — admin routes mounted with `requireSuperAdmin` middleware
- `AdminController` in `backend/src/controllers/adminController.js` — existing admin handlers
- No IP whitelist table or API endpoints

### Gap Analysis
- No database table to store whitelisted IPs
- No admin API to manage the whitelist
- Rate limiter middleware doesn't check whitelist before applying limits

---

## Design

### Option A: Extend Existing Admin Structure (Recommended)

```
Database migration:
  backend/src/migrations/XXX_create_ip_whitelist_table.sql
    → CREATE TABLE ip_whitelist (id SERIAL PK, ip_address VARCHAR(45) UNIQUE,
      description TEXT, created_by INTEGER, created_at TIMESTAMP DEFAULT NOW())
    → Rollback: DROP TABLE ip_whitelist

IpWhitelistService (NEW):
  backend/src/services/IpWhitelistService.js
    → list(): SELECT * FROM ip_whitelist ORDER BY created_at DESC
    → create(ip_address, description, created_by): INSERT with IP validation
    → delete(id): DELETE FROM ip_whitelist WHERE id = $1
    → validateIp(ip): regex check for IPv4/IPv6

AdminController changes:
  backend/src/controllers/adminController.js
    → listIpWhitelist(): GET /api/v1/admin/ip-whitelist
    → createIpWhitelist(): POST /api/v1/admin/ip-whitelist
    → deleteIpWhitelist(): DELETE /api/v1/admin/ip-whitelist/:id

Rate limiter middleware changes:
  backend/src/middleware/rateLimiter.js
    → Before rate limit check: query ip_whitelist for req.ip
    → If found, skip rate limit (return next())
```

### Option B: Separate Whitelist Service + Middleware
- Create `IpWhitelistMiddleware.js` that checks whitelist before rate limiter
- Cleaner separation but more middleware chain complexity
- Would need to order middleware carefully

### Option C: In-Memory Whitelist
- Store whitelisted IPs in application memory
- **Cons**: Lost on restart, no persistence
- **Decision**: Use database — persists across restarts, admin-managed

**Decision**: Option A — extend existing admin structure. Follows existing patterns for admin CRUD endpoints.

---

## Database Schema

### Migration: `XXX_create_ip_whitelist_table.sql`

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

### Rollback: `XXX_create_ip_whitelist_table_rollback.sql`

```sql
DROP TABLE IF EXISTS ip_whitelist;
```

### ip_whitelist table
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL | Primary key |
| ip_address | VARCHAR(45) | IPv4 or IPv6 (45 chars covers IPv6 with zone ID) |
| description | TEXT | Optional description of why IP is whitelisted |
| created_by | INTEGER | FK to users(id) — who added the IP |
| created_at | TIMESTAMP | When the IP was added |

---

## API Design

### List Whitelisted IPs
```
GET /api/v1/admin/ip-whitelist
Authorization: Bearer <token> (SUPER_ADMIN only)

Response:
{
  "success": true,
  "data": [
    {
      "id": 1,
      "ip_address": "203.0.113.50",
      "description": "CI/CD pipeline",
      "createdBy": 3,
      "createdAt": "2025-07-12T10:00:00.000Z"
    }
  ]
}
```

### Add IP to Whitelist
```
POST /api/v1/admin/ip-whitelist
Authorization: Bearer <token> (SUPER_ADMIN only)
Content-Type: application/json

Request:
{
  "ip_address": "203.0.113.50",
  "description": "CI/CD pipeline"
}

Response:
{
  "success": true,
  "data": {
    "id": 2,
    "ip_address": "203.0.113.50",
    "description": "CI/CD pipeline",
    "createdBy": 1,
    "createdAt": "2025-07-12T11:00:00.000Z"
  }
}
```

### Remove IP from Whitelist
```
DELETE /api/v1/admin/ip-whitelist/:id
Authorization: Bearer <token> (SUPER_ADMIN only)

Response:
{
  "success": true,
  "data": {
    "id": 2,
    "ip_address": "203.0.113.50",
    "message": "IP removed from whitelist"
  }
}
```

---

## Rate Limiter Integration

### Modified `rateLimiter.js`

```javascript
async function rateLimiter(req, res, next) {
  // Check whitelist first
  const { pool } = require('../db');
  const whitelistCheck = await pool.query(
    'SELECT 1 FROM ip_whitelist WHERE ip_address = $1',
    [req.ip]
  );

  if (whitelistCheck.rows.length > 0) {
    return next(); // Skip rate limit for whitelisted IPs
  }

  // Existing rate limit logic...
}
```

### Performance Consideration
- Whitelist check adds one DB query per rate-limited request
- Mitigation: Cache whitelist in memory with periodic refresh (deferred to bp-XX-whitelist-cache)
- For now, direct DB query is acceptable (whitelist is small, rarely changed)

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Backend unit | Jest | `backend/src/__tests__/ipWhitelist.test.js` | CRUD operations, IP validation |
| API endpoint | Jest + supertest | `backend/src/__tests__/ipWhitelistApi.test.js` | 403 for non-admin, 200 for admin |
| **Bash integration** | curl + helpers | `backend/integration-test/suites/ip-whitelist.test.sh` | Full CRUD flow, rate limit bypass |

### Test Cases

```javascript
// ipWhitelist.test.js
describe('IpWhitelistService', () => {
  it('lists all whitelisted IPs', async () => {
    // Stub pool.query
    // Assert list returns all IPs
  });

  it('creates a whitelisted IP with validation', async () => {
    // Stub pool.query
    // Assert INSERT called with valid IP
  });

  it('rejects invalid IP addresses', async () => {
    // Pass invalid IP like "not-an-ip"
    // Assert AppError thrown
  });

  it('deletes a whitelisted IP', async () => {
    // Stub pool.query
    // Assert DELETE called
  });
});
```

---

## Risks and Edge Cases

### Backend Risks
- **[Performance]**: DB query on every rate-limited request — Mitigation: Acceptable for now (whitelist is small), cache in future
- **[IP spoofing]**: `req.ip` could be spoofed if behind proxy — Mitigation: Trust proxy setting (`app.set('trust proxy', true)`), validate `X-Forwarded-For`
- **[Duplicate IPs]**: User tries to add an IP that's already whitelisted — Mitigation: UNIQUE constraint returns error, handle gracefully

### Edge Cases
- **[IPv6 addresses]**: IPv6 addresses are longer than IPv4 — Handle: VARCHAR(45) covers full IPv6 with zone ID
- **[CIDR notation]**: User tries to add "10.0.0.0/24" — Handle: Reject with validation error (out of scope: CIDR support)
- **[Empty whitelist]**: No IPs whitelisted — Handle: Query returns empty array, rate limiting applies normally
- **[Deleted user]**: `created_by` references a deleted user — Handle: Acceptable (FK constraint, admin manages lifecycle)

---

## Alternative Designs Considered

### Alternative 1: Environment Variable Whitelist
- Whitelist IPs via env var: `WHITELISTED_IPS=10.0.0.1,10.0.0.2`
- **Pros**: Simple, no DB changes
- **Cons**: Requires restart to change, no audit trail, no admin management
- **Decision**: Use database — admin-managed, no restart needed

### Alternative 2: Redis Cache for Whitelist
- Store whitelist in Redis for fast lookups
- **Pros**: Fast, no DB query per request
- **Cons**: New dependency (Redis), whitelist lost on restart
- **Decision**: Use database — simpler, no new dependencies

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

## Specification Generation

If a small model (7B–34B) will execute this ticket, the information above should be distilled into `04_SPECIFICATION.md` — a file that specifies exact file paths, imports, function signatures, test expectations, and edge cases. The small model should not need to make any architecture decisions; those are encoded in the Specification.

- [ ] `04_SPECIFICATION.md` has been created with exact file operations for each file
- [ ] Test expectations are specific (not "test it works" but "returns 400 when IP is invalid")
- [ ] Edge cases are enumerated explicitly
- [ ] Imports and dependencies are listed per file
- [ ] **Pending scope items presented to user**: All deferred improvements from previous tickets have been listed above and presented to the user

---

*This design document guides implementation. The "Extend Existing Structure" section is the most important — it tells the agent exactly how to add to what already exists rather than creating new code from scratch.*
