# 04_SPECIFICATION.md — PgBouncer Deployment Execution Spec

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

### CREATE: `pgbouncer/pgbouncer.ini`

**Contents**:
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

### CREATE: `pgbouncer/userlist.txt`

**Contents**:
```
"postgres" "md5$(echo -n 'changeme' | md5sum | cut -d' ' -f1)postgres"
```

**Note**: The password hash should be `md5(password + username)`. For development, you can use:
```
"postgres" "md5d8ca39a3c0e7e8b5f8c8e8b5f8c8e8b5"
```

Or for simplicity in dev:
```
"postgres" "changeme"
```

### MODIFY: `docker-compose.yml`

**Add PgBouncer service** (after postgres service definition):
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

**Update PostgreSQL service** (remove port mapping):
```yaml
# Find the postgres service and remove or comment out:
# ports:
#   - "5432:5432"

# Keep the networks and other config
```

### MODIFY: `docker-compose.override.yml`

**Add dev profile for direct PG access**:
```yaml
# Add to postgres service:
# postgres:
#   profiles:
#     - dev
#   ports:
#     - "5432:5432"
```

### MODIFY: `backend/.env`

**Update DATABASE_URL**:
```bash
# OLD:
DATABASE_URL=postgresql://postgres:changeme@localhost:5432/vibecode

# NEW:
DATABASE_URL=postgresql://postgres:changeme@localhost:6432/vibecode
```

### MODIFY: `backend/src/db.js`

**Reduce pool size** (PgBouncer handles pooling):
```javascript
// Change:
max: parseInt(process.env.DATABASE_POOL_MAX) || 20,

// To:
max: parseInt(process.env.DATABASE_POOL_MAX) || 5,
```

### CREATE: `backend/integration-test/suites/pgbouncer.test.sh`

**Contents**:
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

---

## Test Expectations

List every test case the model must create, organized by layer. Do not write "test it works" — each case must describe a specific input, expected output, and why it matters.

### Backend Integration Tests — PgBouncer
```
✓ [happy] PgBouncer container starts successfully
✓ [happy] Backend connects to PgBouncer on port 6432
✓ [happy] Database queries work through PgBouncer
✓ [happy] Health check endpoint responds correctly
✓ [edge] Multiple concurrent queries work through PgBouncer
✓ [edge] Transaction mode works correctly (BEGIN/COMMIT)
```

---

## Edge Cases to Handle

1. **[Connection storms]**: Multiple backend instances starting simultaneously — Handle: PgBouncer reserve_pool handles overflow
2. **[PostgreSQL restart]**: PgBouncer loses connection to PG — Handle: PgBouncer auto-reconnects
3. **[Pool exhaustion]**: All PgBouncer connections in use — Handle: Increase default_pool_size or max_client_conn
4. **[Transaction mode]**: Transactions span multiple queries — Handle: Transaction mode returns connection after each query, safe for most use cases
5. **[Prepared statements]**: PgBouncer doesn't support prepared statements in transaction mode — Handle: pg library handles this automatically

---

## Existing Code Patterns to Follow

- Docker Compose follows existing patterns (services, networks, volumes)
- Backend pool config uses existing env var pattern
- Integration tests follow existing bash script pattern

---

## Pending Scope Items

**All deferred improvements from previous tickets' "Out of Scope" sections that are relevant to this ticket have been presented to the user in the 01/02/03 documents above.**

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-81-email-notifications | ☐ |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting | ☐ |
| 3 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation | ☐ |
| 4 | bp-07-structured-logging | Log aggregation pipeline (Datadog, CloudWatch) | Observability | bp-82-log-aggregation | ☐ |
| 5 | bp-14-ticket-planning | S3 integration (migrate planning files from filesystem to S3) | Infrastructure | bp-83-s3-migration | ☐ |

**If no deferred improvements are found, write: "No deferred improvements found in previous tickets."**

---

## Files NOT to Change

- `frontend/src/` — no frontend changes
- `backend/src/api/` — no API changes
- `backend/src/services/` — no service changes
- `agent/` — no Java agent changes

---

*This specification is the contract between planning and execution. If the model cannot produce code matching this spec, it should request human feedback rather than guessing.*
