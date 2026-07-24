# 04_SPECIFICATION.md — PgBouncer TLS Execution Spec

**Use this file when a small model (7B–34B) will execute the ticket.**

**Generated from**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`
**Target model**: 34B local model
**Date**: 2025-07-24

---

## File Operations

### CREATE: `scripts/generate-certs.sh`

```bash
#!/usr/bin/env bash
set -e

# Create certs directory
mkdir -p pgbouncer/certs

# Generate CA
openssl genrsa -out pgbouncer/certs/ca.key 4096
openssl req -new -x509 -days 3650 -key pgbouncer/certs/ca.key \
  -out pgbouncer/certs/ca.crt \
  -subj "/CN=Vibecode CA"

# Generate server key and CSR
openssl genrsa -out pgbouncer/certs/server.key 4096
openssl req -new -key pgbouncer/certs/server.key \
  -out pgbouncer/certs/server.csr \
  -subj "/CN=pgbouncer"

# Sign server cert with CA
openssl x509 -req -days 3650 \
  -in pgbouncer/certs/server.csr \
  -CA pgbouncer/certs/ca.crt \
  -CAkey pgbouncer/certs/ca.key \
  -CAcreateserial \
  -out pgbouncer/certs/server.crt

# Set permissions
chmod 600 pgbouncer/certs/server.key
chmod 644 pgbouncer/certs/ca.crt pgbouncer/certs/server.crt

echo "Certificates generated in pgbouncer/certs/"
echo "  - ca.crt (CA certificate)"
echo "  - ca.key (CA private key)"
echo "  - server.crt (server certificate)"
echo "  - server.key (server private key)"
```

**Make executable**: `chmod +x scripts/generate-certs.sh`

### MODIFY: `pgbouncer/pgbouncer.ini`

**Replace** the entire file with:

```ini
[databases]
vibecode = host=postgres port=5432 dbname=vibecode sslmode=require

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

# TLS settings
ssl = require
ssl_cert_file = /etc/pgbouncer/certs/server.crt
ssl_key_file = /etc/pgbouncer/certs/server.key
ssl_ca_file = /etc/pgbouncer/certs/ca.crt
```

### MODIFY: `docker-compose.yml`

**Update PgBouncer service** (around line 167-192):

Before:
```yaml
pgbouncer:
  # ... existing config ...
  volumes:
    - ./pgbouncer/pgbouncer.ini:/etc/pgbouncer/pgbouncer.ini:ro
    - ./pgbouncer/userlist.txt:/etc/pgbouncer/userlist.txt:ro
```

After:
```yaml
pgbouncer:
  # ... existing config ...
  volumes:
    - ./pgbouncer/pgbouncer.ini:/etc/pgbouncer/pgbouncer.ini:ro
    - ./pgbouncer/userlist.txt:/etc/pgbouncer/userlist.txt:ro
    - ./pgbouncer/certs:/etc/pgbouncer/certs:ro
```

**Update PostgreSQL service** (around line 144-165):

Before:
```yaml
postgres:
  # ... existing config ...
  volumes:
    - postgres_data:/var/lib/postgresql/data
```

After:
```yaml
postgres:
  # ... existing config ...
  volumes:
    - postgres_data:/var/lib/postgresql/data
    - ./pgbouncer/certs:/etc/postgresql/certs:ro
  command: >
    postgres
    -c ssl=on
    -c ssl_cert_file=/etc/postgresql/certs/server.crt
    -c ssl_key_file=/etc/postgresql/certs/server.key
    -c ssl_ca_file=/etc/postgresql/certs/ca.crt
```

**Update API service** (around line 53-96):

Before:
```yaml
api:
  environment:
    - DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD:-changeme}@pgbouncer:6432/vibecode
```

After:
```yaml
api:
  environment:
    - DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD:-changeme}@pgbouncer:6432/vibecode?sslmode=require
```

**Update migration service** (around line 29-51):

Before:
```yaml
migrate:
  environment:
    - DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD:-changeme}@pgbouncer:6432/vibecode
```

After:
```yaml
migrate:
  environment:
    - DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD:-changeme}@pgbouncer:6432/vibecode?sslmode=require
    - PGSSLMODE=require
```

---

## Test Expectations

### Infrastructure Verification
```
✓ [happy] generate-certs.sh creates CA, server cert, server key
✓ [happy] PgBouncer starts with TLS configuration
✓ [happy] PostgreSQL starts with TLS configuration
✓ [happy] API connects successfully with sslmode=require
✓ [happy] Migrations run successfully with TLS
✓ [edge] Self-signed certs work in local development
```

---

## Edge Cases to Handle

1. **[Self-signed certs in prod]**: Use real certificates (Vault, Let's Encrypt, cloud provider) in production. Self-signed certs are for dev only.
2. **[Certificate expiry]**: Self-signed certs expire in 3650 days (10 years). No rotation needed for dev.
3. **[Client cert verification]**: Not implemented (mTLS). Start with server TLS only (`ssl = require`).
4. **[PgBouncer image]**: `edoburu/pgbouncer:latest` supports TLS via `ssl_cert_file` and `ssl_key_file` in config file.

---

## Existing Code Patterns to Follow

- Docker Compose uses `volumes` for config files and certificates
- PostgreSQL uses `command` to override default startup parameters
- PgBouncer uses `.ini` config file for settings
- `sslmode=require` tells PostgreSQL client to use TLS (no client cert verification)

---

## Pending Scope Items

**All deferred improvements from previous tickets' "Out of Scope" sections that are relevant to this ticket have been presented to the user in the 01/02/03 documents above.**

---

## Files NOT to Change

- `pgbouncer/userlist.txt` — authentication file unchanged
- `docker-compose.override.yml` — no changes needed (self-signed certs work for dev)
- `backend/src/db.js` — pg library handles `sslmode` in connection string

---

*This specification is the contract between planning and execution.*
