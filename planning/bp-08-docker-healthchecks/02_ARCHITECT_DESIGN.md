# 02_ARCHITECT_DESIGN.md — Docker Health Checks

**Status**: planned
**Date created**: 2026-06-17
**Author**: AI Assistant

---

## Problem Statement

Docker containers have no health checks. Failed containers don't restart automatically. Startup ordering is based on `depends_on` (which doesn't wait for readiness).

---

## Current State

```yaml
# docker-compose.yml
services:
  api:
    depends_on: [migrate]
  frontend:
    depends_on: [api]
```

No health checks. No automatic restart. No readiness probes.

---

## Design

### Backend Health Endpoint

```javascript
// backend/src/index.js
router.get('/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    },
  });
});
```

### Docker Health Checks

```yaml
# docker-compose.yml
services:
  api:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 10s

  frontend:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:80/"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 5s

  db:
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U vibecode"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 5s
```

### Startup Order with Health Checks

```yaml
# docker-compose.yml
services:
  migrate:
    depends_on:
      db:
        condition: service_healthy
  api:
    depends_on:
      migrate:
        condition: service_completed_successfully
      db:
        condition: service_healthy
  frontend:
    depends_on:
      api:
        condition: service_healthy
```

### Alternative Designs Considered

- **`wget` over `curl`** — Chose `curl` over `wget` because: `curl` is more widely available in Alpine-based images (via `curl` package) and provides better HTTP status code handling (`-f` flag). `wget` was considered but rejected because: it requires `--spider` flag and has less intuitive error handling for HTTP status codes.
- **DB-aware health check** — Chose simple HTTP health check (no DB) over DB-aware health check because: it avoids the infinite restart loop if the database is down. DB-aware was considered but rejected because: if `/health` checks DB and DB is down, the health check fails → container restarts → infinite loop, which is worse than a degraded service.
- **Liveness vs Readiness probes** — Chose single health check over separate liveness/readiness because: Docker Compose does not support Kubernetes-style separate probes. Separate probes were considered but rejected because: they require a more complex orchestration tool (Kubernetes) which is outside the scope of the current Docker Compose setup.

### Data Flow Diagram

```
Docker Engine (every 10s)
    ↓
  [healthcheck test] → CMD curl -f http://localhost:3001/health
    ↓
  [HTTP response 200?]
    ├─ Yes → status: healthy → continue
    └─ No  → retry counter++
                ↓
      [retries >= 3?]
        ├─ Yes → status: unhealthy → restart container
        └─ No  → wait 10s → retry
    ↓
  [service_healthy condition met]
    ↓
  next service starts (depends_on condition)
```

### Config / Env Changes

- CHANGED: `docker-compose.yml` — add `healthcheck` to `api`, `frontend`, and `db` services
- CHANGED: `docker-compose.yml` — add `condition: service_healthy` to `depends_on` for startup ordering
- CHANGED: `Dockerfile` (api) — ensure `curl` is installed (`RUN apk add --no-cache curl` for Alpine)
- CHANGED: `Dockerfile` (frontend) — ensure `curl` is installed
- CHANGED: `backend/src/index.js` — ensure `/health` endpoint exists and returns `{ success: true, data: { status: 'ok' } }`

---

## Dependencies

- **curl** — must be installed in Docker images
- **pg_isready** — must be available in PostgreSQL image (built-in)

---

## Risks/Edge Cases

- **[curl not installed]**: Alpine images don't include curl. Mitigation: use `wget` or install curl.
- **[Health check loop]**: If /health checks DB and DB is down, health check fails → container restarts → infinite loop. Mitigation: keep /health simple (no DB check).
- **[Start period]**: Container needs time to start. Set `start_period` long enough for cold start.

---

*Ready for implementation phase.*
