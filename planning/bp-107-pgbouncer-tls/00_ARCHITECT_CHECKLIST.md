# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: planned
**Date started**: {{DATE}}
**Date completed**: {{DATE}}
**Author**: AI Assistant
**Feature scope**: Infrastructure

---

## Pre-Implementation Checklist

### Planning

- [ ] I have read `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`
- [ ] I know what is IN scope and OUT of scope

### Existing Infrastructure Audit

- [ ] I have verified `docker-compose.yml` — PgBouncer connects to PostgreSQL via `postgres:5432`
- [ ] I have verified `pgbouncer/pgbouncer.ini` — uses `auth_type = md5`, no TLS configured
- [ ] I have verified API connects via `postgresql://postgres:xxx@pgbouncer:6432/vibecode`

### Testing Strategy

- [ ] Verify PgBouncer starts with TLS configuration
- [ ] Verify API connects successfully with TLS
- [ ] Verify PostgreSQL accepts TLS connections

### Implementation Readiness

- [ ] I know which files to create vs. modify
- [ ] I know how to test

## Post-Implementation Checklist

- [ ] PgBouncer configured with TLS
- [ ] PostgreSQL configured with TLS
- [ ] API connects via `sslmode=require`
- [ ] Docker Compose generates self-signed certs for dev
- [ ] No regression in local development

---

*This checklist prevents agents from skipping planning and jumping straight to coding.*
