# 02_ARCHITECT_DESIGN.md — PgBouncer Design

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Infrastructure
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, `04_SPECIFICATION.md`

---

## Problem Statement

Backend connects directly to PostgreSQL with a pool of 20 connections. At scale, this becomes a bottleneck — each backend instance needs its own pool, and connections are not shared. PgBouncer provides connection pooling at the database level.

---

## Current State

### Existing Backend
- `backend/src/db.js` — `pg.Pool` with max 20 connections
- Pool config via env vars: `DATABASE_POOL_MAX`, `DATABASE_IDLE_TIMEOUT_MS`, etc.
- Backend connects directly to PostgreSQL on port 5432

### Existing Docker Compose
- PostgreSQL service on port 5432
- Backend connects directly to PostgreSQL
- No connection pooling proxy

### Gap Analysis
- No PgBouncer service
- Backend connects directly to PostgreSQL
- No connection pooling at infrastructure level

---

## Design

### Option A: PgBouncer in Docker Compose (Recommended)

```
docker-compose.yml changes:
  → Add PgBouncer service (image: edoburu/pgbouncer)
  → Configure PgBouncer (auth_file, pool_size, min_pool_size)
  → Update PostgreSQL port mapping (5432 → internal only)
  → Expose PgBouncer on port 6432

PgBouncer config:
  pgbouncer/pgbouncer.ini
    → auth_file = /etc/pgbouncer/userlist.txt
    → pool_mode = transaction
    → default_pool_size = 20
    → min_pool_size = 5
    → reserve_pool_size = 5

Backend changes:
  backend/src/db.js
    → DATABASE_URL points to PgBouncer (port 6432)
    → Reduce pool size (PgBouncer handles pooling, so backend pool can be smaller)
```

### Option B: Separate PgBouncer Container
- Deploy PgBouncer separately from docker-compose
- More complex networking
- Easier to scale independently
- Overkill for current setup

### Option C: Cloud Provider Managed PgBouncer
- Use RDS Proxy (AWS) or Cloud SQL Proxy (GCP)
- No infrastructure management
- Vendor lock-in
- Not applicable for Docker-based deployment

**Decision**: Option A — PgBouncer in docker-compose. Simple, follows existing patterns, easy to manage.

---

## Docker Compose Design

### PgBouncer Service

```yaml
services:
  pgbouncer:
    image: edoburu/pgbouncer:1.20.1
    ports:
      - "6432:6432"
    volumes:
      - ./pgbouncer/pgbouncer.ini:/etc/pgbouncer/pgbouncer.ini:ro
      - ./pgbouncer/userlist.txt:/etc/pgbouncer/userlist.txt:ro
    environment:
      - DATABASE_URL=postgresql://vibecode:${POSTGRES_PASSWORD}@postgres:5432/vibecode?sslmode=disable
      - PGBORUER_ADMIN_USERS=postgres
      - PGBORUER_STATS_USERS=postgres
    depends_on:
      - postgres
    restart: unless-stopped
```

### PgBouncer Configuration

```ini
# pgbouncer/pgbouncer.ini
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

### PgBouncer Auth File

```
# pgbouncer/userlist.txt
"vibecode" "postgres_password_hash"
"postgres" "postgres_password_hash"
```

---

## Backend Changes

### DATABASE_URL Update

```bash
# OLD
DATABASE_URL=postgresql://postgres:changeme@localhost:5432/vibecode

# NEW
DATABASE_URL=postgresql://postgres:changeme@localhost:6432/vibecode
```

### Pool Size Adjustment

Since PgBouncer handles pooling, backend pool can be reduced:

```javascript
// OLD: max 20 connections
max: parseInt(process.env.DATABASE_POOL_MAX) || 20,

// NEW: max 5 connections (PgBouncer handles pooling)
max: parseInt(process.env.DATABASE_POOL_MAX) || 5,
```

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Integration | Docker + curl | `backend/integration-test/run.sh` | Backend connects through PgBouncer |
| Manual | Docker compose | `docker compose up` | PgBouncer starts, health check passes |

### Bash Integration Suite

Add `backend/integration-test/suites/pgbouncer.test.sh`:
```bash
# 1. Verify PgBouncer is running
# 2. Connect to PgBouncer (port 6432)
# 3. Execute query through PgBouncer
# 4. Verify response matches direct PG query
```

---

## Risks and Edge Cases

### Infrastructure Risks
- **[Connection storms]**: Multiple backend instances starting simultaneously — Mitigation: PgBouncer reserve_pool handles overflow
- **[PostgreSQL restart]**: PgBouncer loses connection to PG — Mitigation: PgBouncer auto-reconnects
- **[Pool exhaustion]**: All PgBouncer connections in use — Mitigation: Increase default_pool_size or max_client_conn

### Edge Cases
- **[Transaction mode]**: Transactions span multiple queries — Handle: Transaction mode returns connection after each query, safe for most use cases
- **[Prepared statements]**: PgBouncer doesn't support prepared statements in transaction mode — Handle: pg library handles this automatically
- **[Idle transactions]**: Long-running transactions hold connections — Handle: idle_transaction_timeout in PgBouncer config

---

## Alternative Designs Considered

### Alternative 1: Separate PgBouncer Container
- **Pros**: Easier to scale independently
- **Cons**: More complex networking, separate deployment
- **Decision**: Docker-compose is simpler for current setup

### Alternative 2: Cloud Provider Managed PgBouncer
- **Pros**: No infrastructure management
- **Cons**: Vendor lock-in, not applicable for Docker
- **Decision**: Self-hosted PgBouncer for now

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

## Specification Generation

If a small model (7B–34B) will execute this ticket, the information above should be distilled into `04_SPECIFICATION.md` — a file that specifies exact file paths, imports, function signatures, test expectations, and edge cases. The small model should not need to make any architecture decisions; those are encoded in the Specification.

- [ ] `04_SPECIFICATION.md` has been created with exact file operations for each file
- [ ] Test expectations are specific (not "test it works" but "returns 400 when email is missing")
- [ ] Edge cases are enumerated explicitly
- [ ] Imports and dependencies are listed per file
- [ ] **Pending scope items presented to user**: All deferred improvements from previous tickets have been listed above and presented to the user

---

*This design document guides implementation. The "Extend Existing Structure" section is the most important — it tells the agent exactly how to add to what already exists rather than creating new code from scratch.*
