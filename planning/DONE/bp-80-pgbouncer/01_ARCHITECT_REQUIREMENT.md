# 01_ARCHITECT_REQUIREMENT.md — PgBouncer Deployment

**Status**: completed
**Date created**: 2025-07-12
**Date completed**: 2025-07-24
**Author**: AI Assistant
**Scope**: Infrastructure
**Priority**: P2 (Infrastructure)
**Effort**: Medium

---

## Requirement

Deploy PgBouncer as a connection pooling proxy between the backend and PostgreSQL. Currently, the backend connects directly to PostgreSQL with a pool of up to 20 connections. At scale, this becomes a bottleneck — each backend instance needs its own pool, and connections are not shared.

---

## Existing Infrastructure Audit

### Backend API Check
- [x] DB pool configured: `backend/src/db.js` — `pg.Pool` with max 20 connections
- [x] Pool config via env vars: `DATABASE_POOL_MAX`, `DATABASE_IDLE_TIMEOUT_MS`, `DATABASE_CONNECTION_TIMEOUT_MS`, `DATABASE_MAX_USES`
- [x] Docker Compose: PostgreSQL service running in Docker

### Gap Analysis
- No PgBouncer in docker-compose
- Backend connects directly to PostgreSQL (port 5432)
- No connection pooling proxy
- No PgBouncer configuration

### Key Insight

Adding PgBouncer requires:
1. Add PgBouncer service to docker-compose
2. Configure PgBouncer (auth, pool sizes, stats)
3. Update backend to connect to PgBouncer (port 6432) instead of PostgreSQL (port 5432)
4. Add PgBouncer admin/stats endpoints for monitoring

---

## Scope

### In Scope
- Add PgBouncer service to docker-compose.yml
- Configure PgBouncer (auth_file, pool_size, min_pool_size, reserve_pool)
- Add PgBouncer stats endpoint (`pgbouncer` database)
- Update backend DATABASE_URL to point to PgBouncer (port 6432)
- Add PgBouncer health check
- Tests: verify backend connects through PgBouncer

### Out of Scope
- PgBouncer TLS/mTLS configuration
- PgBouncer sharding (multiple backends)
- PgBouncer auto-scaling
- PgBouncer configuration UI
- Connection pool metrics export to Prometheus (deferred to bp-76)

---

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-81-email-notifications | ☐ |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting | ☐ |
| 3 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation | ☐ |
| 4 | bp-07-structured-logging | Log aggregation pipeline (Datadog, CloudWatch) | Observability | bp-82-log-aggregation | ☐ |
| 5 | bp-14-ticket-planning | S3 integration (migrate planning files from filesystem to S3) | Infrastructure | bp-83-s3-migration | ☐ |

**All items above must be presented to the user before ticket approval.**

---

## Deferred Improvements Found (Internal Tracking)

| # | From Ticket | Improvement | Category | Suggested Next Ticket |
|---|-------------|-------------|----------|----------------------|
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-81-email-notifications |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting |
| 3 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation |
| 4 | bp-07-structured-logging | Log aggregation pipeline (Datadog, CloudWatch) | Observability | bp-82-log-aggregation |
| 5 | bp-14-ticket-planning | S3 integration (migrate planning files from filesystem to S3) | Infrastructure | bp-83-s3-migration |

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `docker-compose.yml` | MODIFY | Add PgBouncer service, update PG port |
| `docker-compose.override.yml` | MODIFY | Update dev PG port |
| `backend/.env` (or env vars) | MODIFY | Update DATABASE_URL to use PgBouncer port |
| `backend/src/db.js` | MODIFY | May need pool config adjustments |
| `pgbouncer/pgbouncer.ini` | CREATE | PgBouncer configuration |
| `pgbouncer/userlist.txt` | CREATE | PgBouncer auth file |

---

## Known Unknowns

1. **Should PgBouncer run in transaction or session pooling mode?** — Assumed transaction mode (default, fastest, safest for most use cases). Session mode is safer but uses more connections.
2. **Should PgBouncer be in docker-compose or separate?** — Assumed in docker-compose (simpler for now). Separate deployment can be done later.
3. **How many backend instances?** — Assumed 1 (single backend). Multiple instances benefit more from PgBouncer.

---

## Important Design Decisions

**DECISION POINTS** — Items that need user confirmation.

1. **PgBouncer pooling mode?** — Transaction (default, fastest) — or Session (safer, more connections)? — {{transaction / session}}
2. **PgBouncer port?** — 6432 (default) — or custom? — {{6432 / custom}}

**If no decisions need user input, write: "No design decisions require user input. All choices follow existing patterns."**

---

## Acceptance Criteria

1. [ ] [Infrastructure] PgBouncer service added to docker-compose.yml
2. [ ] [Infrastructure] PgBouncer configuration file created
3. [ ] [Infrastructure] PgBouncer auth file created
4. [ ] [Infrastructure] Backend connects to PgBouncer (port 6432) instead of PostgreSQL (port 5432)
5. [ ] [Infrastructure] PgBouncer health check passes
6. [ ] [Backend] Backend starts and connects successfully through PgBouncer
7. [ ] [Backend] Database queries work correctly through PgBouncer
8. [ ] [Tests] Integration tests pass with PgBouncer

---

## Out of Scope

- PgBouncer TLS/mTLS configuration
- PgBouncer sharding (multiple backends)
- PgBouncer auto-scaling
- PgBouncer configuration UI
- Connection pool metrics export to Prometheus (bp-76)

---

## Performance Considerations

- Expected load: ~20 connections per backend instance
- PgBouncer pool_size: 20 (matches current backend pool)
- PgBouncer min_pool_size: 5 (keep 5 connections warm)
- PgBouncer reserve_pool: 5 (allow overflow during spikes)
- Transaction mode: connections returned to pool immediately after query

---

## Security Considerations

- [ ] PgBouncer auth file should not be committed to git
- [ ] PgBouncer should only accept connections from backend container
- [ ] PostgreSQL should not be exposed directly (only via PgBouncer)

---

## Testing Checklist

### Infrastructure Tests
- [ ] Docker compose starts successfully with PgBouncer
- [ ] Backend connects to PgBouncer
- [ ] Database queries work through PgBouncer
- [ ] PgBouncer health check passes
- [ ] Integration tests pass

---

*Fill in all sections before starting implementation.*
