# 02_ARCHITECT_DESIGN.md — Concurrent Jenkins Builds

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend (CI infrastructure)
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, `04_SPECIFICATION.md`

---

## Problem Statement

Docker Compose containers collide when multiple Jenkins jobs run concurrently on the same agent. The root causes are:
1. A shared project name (`name: vibecode`) forces all builds into the same Docker namespace
2. Hardcoded container names (`vibecode-postgres`, etc.) can only exist once
3. `disableConcurrentBuilds()` in Jenkinsfile prevents concurrent execution entirely
4. Bash integration tests reference containers by hardcoded names

---

## Current State

### Docker Compose
- `docker-compose.yml`: `name: vibecode`, 6 hardcoded `container_name:` directives, network `vibecode`
- `docker-compose.test.yml`: `container_name: vibecode-test`
- `docker-compose.override.yml`: port overrides only (no container names)

### Jenkinsfile
- `disableConcurrentBuilds()` on line 7
- Integration test stage uses `docker compose -f ${DOCKER_COMPOSE_FILE}` commands
- Test container accessed via `docker exec -w /app vibecode-test bash -c '...'`

### Bash Integration Tests
- `helpers.sh`: `docker_exec()` calls `docker exec "$container"` with hardcoded names
- 18 references to `vibecode-postgres`, `vibecode-redis`, `vibecode-pgbouncer` across test files

### Gap Analysis
- **No project isolation** — all builds share the `vibecode` namespace
- **No container name flexibility** — hardcoded names prevent concurrent use
- **No compose-level isolation** — network, volumes, and containers all collide

---

## Design

### Option A: Dynamic `COMPOSE_PROJECT_NAME` (Recommended)

Use the standard Docker Compose environment variable to give each build a unique namespace.

```
COMPOSE_PROJECT_NAME=vibecode-${BRANCH_NAME}-${BUILD_NUMBER}
```

Docker Compose automatically prefixes all resources:
- Containers: `${COMPOSE_PROJECT_NAME}-postgres-1`, `${COMPOSE_PROJECT_NAME}-api-1`, etc.
- Network: `${COMPOSE_PROJECT_NAME}_default`
- Volumes: `${COMPOSE_PROJECT_NAME}_postgres_data`, etc.

Bash tests use `docker compose exec` (resolves service names within the project) instead of `docker exec` (requires exact container names).

**Pros**: Standard Docker Compose mechanism, zero code changes in backend/frontend, local dev unaffected
**Cons**: Bash test helper needs updating to use `docker compose exec`

### Option B: Keep hardcoded names, use separate Docker hosts
- **Pros**: No compose file changes
- **Cons**: Requires multiple Jenkins agents or Docker-in-Docker, expensive
- **Decision**: Not chosen — overkill for this use case

### Option C: Use `docker compose --project-name` flag per command
- **Pros**: Explicit per-command control
- **Cons**: Must pass to every docker compose command, error-prone
- **Decision**: Not chosen — `COMPOSE_PROJECT_NAME` env var is cleaner

---

## How `COMPOSE_PROJECT_NAME` Works

When `COMPOSE_PROJECT_NAME=vibecode-fix-bp-104-42` is set:

```yaml
# docker-compose.yml
services:
  postgres:
    # Container becomes: vibecode-fix-bp-104-42-postgres-1
  api:
    # Container becomes: vibecode-fix-bp-104-42-api-1

networks:
  vibecode:
    # Network becomes: vibecode-fix-bp-104-42_default

volumes:
  postgres_data:
    # Volume becomes: vibecode-fix-bp-104-42_postgres_data
```

The API container's `CONTAINER_NETWORK` env var must match: `${COMPOSE_PROJECT_NAME}_default`.

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `docker-compose.yml` | MODIFY | Remove `name:`, 6 `container_name:`, network `name:`, dynamic `CONTAINER_NETWORK` |
| `docker-compose.test.yml` | MODIFY | Remove `container_name:`, add compose mount + `COMPOSE_PROJECT_NAME` env |
| `Jenkinsfile` | MODIFY | Remove `disableConcurrentBuilds()`, add `COMPOSE_PROJECT_NAME`, pass env to test |
| `backend/integration-test/helpers.sh` | MODIFY | `docker_exec`/`docker_exec_out` use `docker compose exec` with service name mapping |

---

## Data Flow: How Container Resolution Works

### Before (hardcoded names)
```
bash test → docker_exec vibecode-postgres psql ...
         → docker exec vibecode-postgres psql ...
         → ✅ works if container is named vibecode-postgres
         → ❌ fails if container is named vibecode-fix-bp-104-42-postgres-1
```

### After (compose project resolution)
```
bash test → docker_exec vibecode-postgres psql ...
         → helper maps: vibecode-postgres → postgres
         → docker compose exec -T postgres psql ...
         → Docker Compose resolves: postgres → vibecode-fix-bp-104-42-postgres-1
         → ✅ works regardless of project name
```

---

## Dependencies

### Backend Dependencies
- None — `PoolManager.js` reads `CONTAINER_NETWORK` env var, already dynamic

### Frontend Dependencies
- None

### CI Dependencies
- Docker Compose v2 (already in use)
- `docker compose exec` available in test container (via Docker socket mount)

---

## Config / Environment Changes

- [ ] New environment variables: `COMPOSE_PROJECT_NAME` (set in Jenkinsfile, propagated to test container)
- [ ] New database migrations: NONE
- [ ] New npm dependencies: NONE
- [ ] Existing config changes: `CONTAINER_NETWORK` now uses `${COMPOSE_PROJECT_NAME}_default`

---

## Database Changes

None.

---

## Security Considerations

- [x] No new secrets or credentials
- [x] No changes to auth/permissions
- [x] Docker socket access unchanged
- [x] No exposure of sensitive data

---

## Testing Strategy

### Test Layers

| Layer | Tool | What It Verifies |
|-------|------|-----------------|
| Local dev | `docker compose up --build` | Default project name still works |
| CI single build | Jenkins pipeline | Normal build succeeds |
| CI concurrent builds | Two parallel Jenkins jobs | No container collisions |

---

## Risks and Edge Cases

### Backend Risks
- **None** — no backend code changes

### CI Risks
- **Test container missing `docker compose` CLI**: Fallback in `docker_exec` to raw `docker exec` handles this
- **Concurrent builds on different agents**: No collision (different Docker hosts)
- **Concurrent builds on same agent**: Resolved by unique `COMPOSE_PROJECT_NAME`
- **Build cleanup**: `docker compose down -v` cleans up project-scoped resources

### Edge Cases
- **Same branch, two builds**: Different `BUILD_NUMBER` → different project name
- **Master branch builds**: `COMPOSE_PROJECT_NAME=vibecode-master-${BUILD_NUMBER}` — unique per build
- **Manual Jenkins builds**: `BUILD_NUMBER` still unique per run

---

## Alternative Designs Considered

### Alternative 1: Per-build Docker network only
- **Pros**: Simpler change
- **Cons**: Doesn't solve container name collisions
- **Decision**: Not chosen — must isolate entire project, not just network

### Alternative 2: Use Docker Compose profiles
- **Pros**: Clean separation of concerns
- **Cons**: Doesn't address naming collisions
- **Decision**: Not chosen — profiles don't solve the core problem

---

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-76 | Distributed tracing | Observability | bp-110-distributed-tracing | ☐ |
| 2 | bp-106 | Log aggregation | Observability | bp-106-log-aggregation | ☐ |
| 3 | bp-101 | Configurable log rotation | Developer experience | bp-101-configurable-log-rotation | ☐ |
| 4 | bp-78 | CSP DB ingestion | Observability | bp-111-csp-db-ingestion | ☐ |
| 5 | bp-78 | CSP router mount | Bug fix | bp-112-csp-router-mount | ☐ |
| 6 | bp-78 | CSP cleanup scheduling | Bug fix | bp-113-csp-cleanup-schedule | ☐ |

---

*This design document guides implementation. The `COMPOSE_PROJECT_NAME` mechanism is the core architectural decision — it provides full project isolation with minimal changes.*
