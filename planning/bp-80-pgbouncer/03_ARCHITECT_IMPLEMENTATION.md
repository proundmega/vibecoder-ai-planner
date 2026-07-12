# 03_ARCHITECT_IMPLEMENTATION.md — PgBouncer Implementation Plan

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Infrastructure
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `04_SPECIFICATION.md`

---

## Implementation Phases

### Phase 1: Create PgBouncer Configuration Files

#### CREATE: `pgbouncer/pgbouncer.ini`

```ini
[databases]
vibecode = host=postgres port=5432 dbname=vibecode

[pgbouncer]
listen_addr = *
listen_port = 6432
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction
default_pool_size = 20
min_pool_size = 5
reserve_pool_size = 5
reserve_pool_timeout = 3
max_client_conn = 200
log_connections = 0
log_disconnections = 0
stats_period = 60
```

#### CREATE: `pgbouncer/userlist.txt`

```
# Format: "username" "password_hash"
# Password hash is md5(password + username)
# For postgres user with password 'changeme':
"postgres" "md5<md5_hash>"
```

**Note**: The actual password hash should be computed as `md5('changeme' + 'postgres')`. For simplicity, use plaintext in dev and compute hash in production.

Alternative (plaintext for dev):
```
"postgres" "changeme"
```

### Phase 2: Update Docker Compose

#### MODIFY: `docker-compose.yml`

**Add PgBouncer service** (after postgres service):
```yaml
  pgbouncer:
    image: edoburu/pgbouncer:1.20.1
    container_name: vibecode-pgbouncer
    ports:
      - "6432:6432"
    volumes:
      - ./pgbouncer/pgbouncer.ini:/etc/pgbouncer/pgbouncer.ini:ro
      - ./pgbouncer/userlist.txt:/etc/pgbouncer/userlist.txt:ro
    environment:
      - DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/vibecode?sslmode=disable
      - PGBORUER_ADMIN_USERS=postgres
      - PGBORUER_STATS_USERS=postgres
    depends_on:
      - postgres
    restart: unless-stopped
    networks:
      - vibecode
```

**Update PostgreSQL port mapping** (remove host port exposure):
```yaml
# OLD:
# ports:
#   - "5432:5432"

# NEW: (no port mapping, only internal)
# (keep networks, remove ports)
```

#### MODIFY: `docker-compose.override.yml`

**Update dev PostgreSQL port** (if needed for direct access):
```yaml
# If developers need direct PG access, keep port 5432 exposed in dev only
# PgBouncer will be on port 6432
```

### Phase 3: Update Backend Configuration

#### MODIFY: `backend/.env` (or environment variables)

**Update DATABASE_URL**:
```bash
# OLD:
DATABASE_URL=postgresql://postgres:changeme@localhost:5432/vibecode

# NEW:
DATABASE_URL=postgresql://postgres:changeme@localhost:6432/vibecode
```

#### MODIFY: `backend/src/db.js`

**Reduce pool size** (PgBouncer handles pooling):
```javascript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.DATABASE_URL_LOCAL,
  max: parseInt(process.env.DATABASE_POOL_MAX) || 5,  // Reduced from 20
  idleTimeoutMillis: parseInt(process.env.DATABASE_IDLE_TIMEOUT_MS) || 30000,
  connectionTimeoutMillis: parseInt(process.env.DATABASE_CONNECTION_TIMEOUT_MS) || 5000,
  maxUses: parseInt(process.env.DATABASE_MAX_USES) || 10000,
});
```

### Phase 4: Tests

#### CREATE: `backend/integration-test/suites/pgbouncer.test.sh`

```bash
#!/bin/bash
set -e

echo "=== PgBouncer Integration Test ==="

# 1. Verify PgBouncer is running
echo "1. Checking PgBouncer is running..."
if ! docker ps | grep -q pgbouncer; then
  echo "FAIL: PgBouncer container not running"
  exit 1
fi

# 2. Connect to PgBouncer
echo "2. Connecting to PgBouncer..."
PGPASSWORD=changeme psql -h localhost -p 6432 -U postgres -d vibecode -c "SELECT 1" > /dev/null
if [ $? -ne 0 ]; then
  echo "FAIL: Cannot connect to PgBouncer"
  exit 1
fi

# 3. Execute query through PgBouncer
echo "3. Executing query through PgBouncer..."
RESULT=$(PGPASSWORD=changeme psql -h localhost -p 6432 -U postgres -d vibecode -t -c "SELECT count(*) FROM users")
echo "Users count: $RESULT"

# 4. Verify backend can connect
echo "4. Verifying backend connection..."
curl -s http://localhost:3001/api/health > /dev/null
if [ $? -ne 0 ]; then
  echo "FAIL: Backend health check failed"
  exit 1
fi

echo "PASS: PgBouncer integration test complete"
```

### Phase 5: Docker Compose Profiles

#### MODIFY: `docker-compose.yml`

**Add dev profile** (for direct PG access in development):
```yaml
# Add to postgres service:
profiles:
  - default
  - dev

# In docker-compose.override.yml, add:
# services:
#   postgres:
#     profiles:
#       - dev
#     ports:
#       - "5432:5432"
```

This allows:
- `docker compose up` — PgBouncer on 6432, no direct PG access
- `docker compose --profile dev up` — PgBouncer on 6432, PG on 5432 (for direct access)

---

## Files Changed

```
pgbouncer/pgbouncer.ini                                                    → CREATE
pgbouncer/userlist.txt                                                     → CREATE
docker-compose.yml                                                         → MODIFY (add PgBouncer, update PG ports)
docker-compose.override.yml                                                → MODIFY (add dev profile for PG)
backend/.env                                                               → MODIFY (update DATABASE_URL)
backend/src/db.js                                                          → MODIFY (reduce pool size)
backend/integration-test/suites/pgbouncer.test.sh                          → CREATE
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
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-81-email-notifications | ☐ |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting | ☐ |
| 3 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation | ☐ |
| 4 | bp-07-structured-logging | Log aggregation pipeline (Datadog, CloudWatch) | Observability | bp-82-log-aggregation | ☐ |
| 5 | bp-14-ticket-planning | S3 integration (migrate planning files from filesystem to S3) | Infrastructure | bp-83-s3-migration | ☐ |

**If no deferred improvements are found, write: "No deferred improvements found in previous tickets."**

**All items above must be presented to the user before ticket approval.**

---

### i) Code Review Checklist

- [ ] Backend follows existing patterns (controller/service/model separation)
- [ ] Backend uses parameterized queries (no SQL injection)
- [ ] Backend has JSDoc OpenAPI annotations
- [ ] Backend response format: `{ success: true, data: { ... } }`
- [ ] Backend errors pass to `next(error)`
- [ ] Frontend API client uses existing `get`, `post`, `put`, `del`, `patch` from `./client`
- [ ] Frontend API client handles errors with `.catch()`
- [ ] Frontend UI follows existing patterns (CSS classes, component structure)
- [ ] Frontend UI handles loading, error, and empty states
- [ ] Frontend UI extends existing code rather than creating new (when possible)
- [ ] Frontend types match backend response shapes
- [ ] All tests written and passing — new/changed code has corresponding test files CREATED or EXTENDED
- [ ] OpenAPI spec regenerated if backend routes changed
- [ ] Generated TypeScript types regenerated if response shapes changed
- [ ] Generated types compile: `npm run typecheck`
- [ ] Response validation updated: `frontend/src/api/validator.ts` matches backend changes
- [ ] Contract test updated: `frontend/src/__tests__/api-contract.test.ts` covers any new/changed fields
- [ ] Bash integration suite test added or extended for API changes
- [ ] **Coverage threshold enforced**: `npm run test:coverage` (backend) or `npm test -- --run --coverage` (frontend) — min 60% lines, functions, branches, statements
- [ ] Specification in `04_SPECIFICATION.md` matches what was actually implemented
- [ ] **Pending scope items presented to user**: All deferred improvements from previous tickets have been listed above and presented to the user

---

### j) Post-Deploy Verification

1. [ ] Docker compose starts successfully with PgBouncer
2. [ ] PgBouncer health check passes
3. [ ] Backend connects to PgBouncer (port 6432)
4. [ ] Database queries work through PgBouncer
5. [ ] Integration tests pass
6. [ ] If specification file exists: implementation matches the spec

---

*Fill in all sections before starting implementation. Update status as work progresses. The "Files Changed" section is the most important — it prevents agents from creating redundant code by forcing them to check what already exists.*
