# 02_ARCHITECT_DESIGN.md — PgBouncer TLS Design

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Infrastructure
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, `04_SPECIFICATION.md`

---

## Problem Statement

Database connections between API → PgBouncer → PostgreSQL are unencrypted. In production, these connections should use TLS.

---

## Design

### Certificate Generation

**CREATE**: `scripts/generate-certs.sh`

Generate self-signed certificates for local development:
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
```

### PgBouncer Configuration

**MODIFY**: `pgbouncer/pgbouncer.ini`

Add TLS settings:
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

### PostgreSQL Configuration

**MODIFY**: `docker-compose.yml`

Add TLS volume mount and env vars to PostgreSQL service:
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

### Docker Compose Updates

**MODIFY**: `docker-compose.yml`

Add TLS volume mounts to PgBouncer:
```yaml
pgbouncer:
  # ... existing config ...
  volumes:
    - ./pgbouncer/pgbouncer.ini:/etc/pgbouncer/pgbouncer.ini:ro
    - ./pgbouncer/userlist.txt:/etc/pgbouncer/userlist.txt:ro
    - ./pgbouncer/certs:/etc/pgbouncer/certs:ro
```

Update API connection string:
```yaml
api:
  environment:
    - DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD:-changeme}@pgbouncer:6432/vibecode?sslmode=require
```

### Local Dev Override

**MODIFY**: `docker-compose.override.yml`

No changes needed — self-signed certs work for both dev and prod (with real certs in prod).

---

## Risks and Edge Cases

- **[Self-signed certs in prod]**: Use real certificates (Vault, Let's Encrypt, cloud provider) in production. Self-signed certs are for dev only.
- **[Certificate expiry]**: Self-signed certs expire in 3650 days (10 years). No rotation needed for dev.
- **[Client cert verification]**: Not implemented (mTLS). Start with server TLS only (`ssl = require`).
- **[PgBouncer image]**: `edoburu/pgbouncer:latest` supports TLS via `ssl_cert_file` and `ssl_key_file` env vars or config file.

---

## Alternative Designs Considered

### Alternative 1: mTLS (mutual TLS)
- **Pros**: Stronger authentication, both sides verify each other
- **Cons**: More complex, requires client certs for API + migration containers
- **Decision**: Start with server TLS only (simpler), add mTLS in future ticket

### Alternative 2: Sidecar proxy (Istio, Linkerd)
- **Pros**: Automatic TLS, service mesh features
- **Cons**: Heavy infrastructure, overkill for current scale
- **Decision**: PgBouncer TLS is sufficient for current needs

---

## Specification Generation

- [ ] `04_SPECIFICATION.md` has been created with exact file operations
- [ ] Test expectations are specific
- [ ] Pending scope items presented to user

---

*This design document guides implementation.*
