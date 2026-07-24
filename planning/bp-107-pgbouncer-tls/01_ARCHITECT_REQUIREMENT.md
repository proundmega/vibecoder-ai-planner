# 01_ARCHITECT_REQUIREMENT.md — PgBouncer TLS/mTLS

**Status**: planned
**Date created**: 2025-07-24
**Date completed**: 
**Author**: AI Assistant
**Scope**: Infrastructure
**Priority**: P2 (Security)
**Effort**: Medium

---

## Requirement

Database connections between API → PgBouncer → PostgreSQL are unencrypted. In production, these connections should use TLS to encrypt traffic. For local development, self-signed certificates are acceptable.

---

## Existing Infrastructure Audit

### Database Connection Check
- [x] PgBouncer: `docker-compose.yml:167-192` — `edoburu/pgbouncer:latest` image
- [x] PgBouncer config: `pgbouncer/pgbouncer.ini` — `auth_type = md5`, no TLS settings
- [x] API connection: `DATABASE_URL=postgresql://postgres:xxx@pgbouncer:6432/vibecode` — no `sslmode`
- [x] PostgreSQL: `docker-compose.yml:144-165` — standard pgvector image
- [x] Docker network: `vibecode` bridge network (internal, not exposed externally)

### Key Insight

The Docker network is internal (bridge), so traffic between containers is already isolated from external networks. TLS adds defense-in-depth:
1. Encrypts traffic in case of container escape or network sniffing
2. Required for compliance (PCI-DSS, HIPAA, etc.)
3. Enables mTLS for mutual authentication between services

---

## Scope

### In Scope
- Generate self-signed certificates for dev (docker-compose-entrypoint script)
- Configure PgBouncer to accept TLS connections (`sslmode=require`)
- Configure PostgreSQL to accept TLS connections
- Update API `DATABASE_URL` to include `sslmode=require`
- Update migration container to use TLS
- Tests: verify PgBouncer starts with TLS, API connects successfully

### Out of Scope
- Certificate rotation/renewal automation
- Production certificate management (Vault, Let's Encrypt)
- mTLS client certificate verification (start with server TLS only)
- Connection pool sizing changes
- PgBouncer sharding/multiple backends

---

## Pending Scope Items to Present to User

All deferred improvements from previous tickets' "Out of Scope" sections that are relevant to this ticket have been presented to the user in the 01/02/03 documents above.

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `docker-compose.yml` | MODIFY | Add TLS config to PgBouncer + PostgreSQL |
| `pgbouncer/pgbouncer.ini` | MODIFY | Add `sslmode=require` |
| `scripts/generate-certs.sh` | CREATE | Generate self-signed certs for dev |
| `docker-compose.override.yml` | MODIFY | Override TLS for local dev |

---

## Acceptance Criteria

1. [ ] Self-signed certificates generated for dev (CA, server cert, server key)
2. [ ] PgBouncer configured with `ssl = require`
3. [ ] PostgreSQL configured with `ssl = on`
4. [ ] API connects via `sslmode=require`
5. [ ] Migration container connects via TLS
6. [ ] Local development works with self-signed certs
7. [ ] No regression in existing functionality

---

## Out of Scope

- Certificate rotation/renewal automation
- Production certificate management
- mTLS client certificate verification
- Connection pool sizing changes
- PgBouncer sharding

---

## Performance Considerations

- TLS adds ~5-10% overhead per connection (acceptable for defense-in-depth)
- Connection pooling (PgBouncer) mitigates TLS handshake overhead
- Self-signed certs in dev have negligible performance impact

---

## Testing Checklist

### Infrastructure Tests
- [ ] PgBouncer starts with TLS configuration
- [ ] API connects successfully with TLS
- [ ] PostgreSQL accepts TLS connections
- [ ] Local development works with self-signed certs

---

*Fill in all sections before starting implementation.*
