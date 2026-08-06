# 03_ARCHITECT_IMPLEMENTATION.md — PgBouncer TLS Implementation Plan

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Infrastructure
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `04_SPECIFICATION.md`

---

## Implementation Phases

### Phase 1: Create Certificate Generation Script

**CREATE**: `scripts/generate-certs.sh`

Generate self-signed CA, server cert, and server key:
```bash
#!/usr/bin/env bash
set -e
mkdir -p pgbouncer/certs
# ... (see 02_ARCHITECT_DESIGN.md for full script)
```

Make executable: `chmod +x scripts/generate-certs.sh`

### Phase 2: Update PgBouncer Config

**MODIFY**: `pgbouncer/pgbouncer.ini`

Add TLS settings:
```ini
[databases]
vibecode = host=postgres port=5432 dbname=vibecode sslmode=require

[pgbouncer]
# ... existing settings ...
ssl = require
ssl_cert_file = /etc/pgbouncer/certs/server.crt
ssl_key_file = /etc/pgbouncer/certs/server.key
ssl_ca_file = /etc/pgbouncer/certs/ca.crt
```

### Phase 3: Update Docker Compose

**MODIFY**: `docker-compose.yml`

1. Add TLS volume mount to PgBouncer service
2. Add TLS volume mount and command to PostgreSQL service
3. Update API `DATABASE_URL` to include `sslmode=require`
4. Update migration `DATABASE_URL` to include `sslmode=require`

### Phase 4: Generate Certs

Run `bash scripts/generate-certs.sh` to generate self-signed certificates for local development.

### Phase 5: Verify & Build

1. Run `docker compose down && docker compose up --build` — verify services start
2. Run `docker compose exec api node -e "require('pg').connect('postgresql://postgres:changeme@pgbouncer:6432/vibecode?sslmode=require')" ` — verify connection
3. Run `docker compose exec api node src/migrations/apply.js` — verify migrations work with TLS

---

## Files Changed

```
scripts/generate-certs.sh                          → CREATE
pgbouncer/pgbouncer.ini                            → MODIFY (add TLS settings)
docker-compose.yml                                 → MODIFY (add TLS volumes + update DATABASE_URL)
```

---

### i) Code Review Checklist

- [ ] `generate-certs.sh` creates CA, server cert, server key
- [ ] Certificates are self-signed, valid for 10 years
- [ ] PgBouncer config has `ssl = require`
- [ ] PgBouncer config has `ssl_cert_file`, `ssl_key_file`, `ssl_ca_file`
- [ ] PostgreSQL config has `ssl = on`
- [ ] API `DATABASE_URL` includes `sslmode=require`
- [ ] Migration `DATABASE_URL` includes `sslmode=require`
- [ ] Docker volumes mount certs correctly
- [ ] Local development works with self-signed certs

### j) Post-Deploy Verification

1. [ ] `docker compose up --build` starts without errors
2. [ ] PgBouncer accepts TLS connections
3. [ ] PostgreSQL accepts TLS connections
4. [ ] API connects successfully with TLS
5. [ ] Migrations run successfully with TLS
6. [ ] No regression in existing functionality

---

*Fill in all sections before starting implementation.*
