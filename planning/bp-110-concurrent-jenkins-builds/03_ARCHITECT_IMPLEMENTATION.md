## Ticket: bp-110 — Concurrent Jenkins Builds

**Status**: planned
**Priority**: P2
**Effort**: Medium
**Author**: AI Assistant
**Date created**: 2026-07-28
**Date completed**: TBD
**PR**: TBD
**Branch**: TBD
**Scope**: Backend (CI infrastructure)

**Dependencies**: None

---

### a) Purpose

Enable concurrent Jenkins builds by giving each build its own Docker Compose project namespace. Currently, hardcoded container names and a shared project name cause collisions when multiple jobs run on the same agent.

---

### b) Actions

#### Implementation Order

1. **Update docker-compose.yml** — Remove static identifiers
   - Remove `name: vibecode`
   - Remove 6 `container_name:` directives
   - Remove network `name: vibecode`
   - Change `CONTAINER_NETWORK=vibecode_default` → `CONTAINER_NETWORK=${COMPOSE_PROJECT_NAME}_default`
   - *Depends on*: nothing

2. **Update docker-compose.test.yml** — Remove container name, add compose mount
   - Remove `container_name: vibecode-test`
   - Add volume mount for compose files
   - Add `COMPOSE_PROJECT_NAME` env var passthrough
   - *Depends on*: Step 1

3. **Update Jenkinsfile** — Enable concurrent builds
   - Remove `disableConcurrentBuilds()`
   - Add `COMPOSE_PROJECT_NAME=vibecode-${BRANCH_NAME}-${BUILD_NUMBER}`
   - Pass `COMPOSE_PROJECT_NAME` to test container
   - *Depends on*: Step 1, Step 2

4. **Update helpers.sh** — Use `docker compose exec`
   - Update `docker_exec()` to map hardcoded names to service names
   - Update `docker_exec_out()` with same pattern
   - *Depends on*: Step 2

5. **Verify** — Test locally and in CI
   - Local dev: `docker compose up --build` works
   - CI: integration tests pass
   - CI: two concurrent builds don't collide

#### Phase 1: docker-compose.yml

Remove `name: vibecode` (line 1).

Remove `container_name:` from all 6 services:
- `vibecode-docker-proxy` (line 6)
- `vibecode-migrate` (line 33)
- `vibecode-api` (line 57)
- `vibecode-frontend` (line 102)
- `vibecode-redis` (line 127)
- `vibecode-postgres` (line 146)
- `vibecode-pgadmin` (line 169)

Change network definition from:
```yaml
networks:
  vibecode:
    driver: bridge
```
To:
```yaml
networks:
  default:
    driver: bridge
```

Change api environment from:
```yaml
- CONTAINER_NETWORK=vibecode_default
```
To:
```yaml
- CONTAINER_NETWORK=${COMPOSE_PROJECT_NAME:-vibecode}_default
```

#### Phase 2: docker-compose.test.yml

Remove `container_name: vibecode-test` (line 16).

Add volume mount to test service:
```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
  - .:/app/compose:ro
```

Add environment variable:
```yaml
- COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-vibecode}
```

#### Phase 3: Jenkinsfile

Remove `disableConcurrentBuilds()` from options block.

Add to environment block:
```groovy
COMPOSE_PROJECT_NAME = "vibecode-${BRANCH_NAME}-${BUILD_NUMBER}"
```

In Integration Tests stage, pass `COMPOSE_PROJECT_NAME` to test container. Change:
```groovy
sh "docker compose -f \${DOCKER_COMPOSE_FILE} -f docker-compose.test.yml up -d test"
```
To:
```groovy
sh "COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME} docker compose -f \${DOCKER_COMPOSE_FILE} -f docker-compose.test.yml up -d test"
```

Also pass env var when exec'ing into test container:
```groovy
sh """
    docker exec -e COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME} -w /app vibecode-test bash -c '...'
"""
```

Wait — we're removing `container_name: vibecode-test`, so `docker exec vibecode-test` won't work. Change to:
```groovy
sh """
    COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME} docker compose -f \${DOCKER_COMPOSE_FILE} -f docker-compose.test.yml exec -T test bash -c '...'
"""
```

#### Phase 4: helpers.sh

Update `docker_exec()` function:

```bash
docker_exec() {
  local container="$1"; shift
  local service="$container"
  case "$container" in
    vibecode-postgres) service="postgres" ;;
    vibecode-redis) service="redis" ;;
    vibecode-pgbouncer) service="pgbouncer" ;;
    vibecode-api) service="api" ;;
    vibecode-test) service="test" ;;
    vibecode-docker-proxy) service="docker-proxy" ;;
    vibecode-migrate) service="migrate" ;;
    vibecode-frontend) service="frontend" ;;
  esac
  # Try docker compose exec first (resolves via project namespace)
  if [ -f /app/compose/docker-compose.yml ]; then
    local compose_args="-f /app/compose/docker-compose.yml"
    [ -f /app/compose/docker-compose.test.yml ] && compose_args="$compose_args -f /app/compose/docker-compose.test.yml"
    if docker compose $compose_args exec -T "$service" "$@" >/dev/null 2>&1; then
      return 0
    fi
  fi
  # Fallback: direct docker exec
  if docker exec "$container" "$@" >/dev/null 2>&1; then
    return 0
  elif command -v sudo >/dev/null 2>&1 && sudo docker exec "$container" "$@" >/dev/null 2>&1; then
    return 0
  else
    echo "docker_exec: failed to execute on container '$container': $*" >&2
    return 1
  fi
}
```

Update `docker_exec_out()` with same pattern (capture output instead of suppress).

---

### c) Per-File Action Plan

#### `docker-compose.yml` (MODIFY)
- Remove line 1: `name: vibecode`
- Remove 7 `container_name:` lines (lines 6, 33, 57, 102, 127, 146, 169)
- Change network from `vibecode:` to `default:`
- Change `CONTAINER_NETWORK=vibecode_default` to `CONTAINER_NETWORK=${COMPOSE_PROJECT_NAME:-vibecode}_default`

#### `docker-compose.test.yml` (MODIFY)
- Remove line 16: `container_name: vibecode-test`
- Add `COMPOSE_PROJECT_NAME` env var to test service
- Add compose file mount to test service volumes

#### `Jenkinsfile` (MODIFY)
- Remove line 7: `disableConcurrentBuilds()`
- Add `COMPOSE_PROJECT_NAME = "vibecode-${BRANCH_NAME}-${BUILD_NUMBER}"` to environment
- Update Integration Tests stage: use `docker compose exec` instead of `docker exec vibecode-test`
- Pass `COMPOSE_PROJECT_NAME` to test container

#### `backend/integration-test/helpers.sh` (MODIFY)
- Update `docker_exec()`: map hardcoded names → service names, use `docker compose exec`
- Update `docker_exec_out()`: same pattern

---

### d) Dependencies

- Docker Compose v2 (already in use)
- Docker socket mounted in test container (already done)

---

### e) Risks/Edge Cases

- **Test container missing docker compose CLI**: Fallback to raw `docker exec` handles this
- **Same branch, two builds**: Different `BUILD_NUMBER` → unique project name
- **Master builds**: `COMPOSE_PROJECT_NAME=vibecode-master-${BUILD_NUMBER}` — unique per build
- **Local dev**: Uses directory name as project (default), unaffected

---

### f) Testing

#### Verification Steps
- [ ] Local dev: `docker compose up --build` works (default project name)
- [ ] CI: single build passes integration tests
- [ ] CI: two concurrent builds on same agent don't collide
- [ ] All bash integration tests pass with dynamic project name
- [ ] No backend/frontend code changes — existing tests unaffected

---

### g) Migration Notes

N/A — no database changes.

---

### h) Files Changed

**Backend:**
```
docker-compose.yml                          → MODIFY (remove static identifiers)
docker-compose.test.yml                     → MODIFY (remove container name, add compose mount)
Jenkinsfile                                 → MODIFY (enable concurrent builds)
backend/integration-test/helpers.sh         → MODIFY (docker compose exec)
```

**Frontend:**
```
(none)
```

---

### Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-76 | Distributed tracing | Observability | bp-110-distributed-tracing | ☐ |
| 2 | bp-106 | Log aggregation | Observability | bp-106-log-aggregation | ☐ |
| 3 | bp-101 | Configurable log rotation | Developer experience | bp-101-configurable-log-rotation | ☐ |
| 4 | bp-78 | CSP DB ingestion | Observability | bp-111-csp-db-ingestion | ☐ |
| 5 | bp-78 | CSP router mount | Bug fix | bp-112-csp-router-mount | ☐ |
| 6 | bp-78 | CSP cleanup scheduling | Bug fix | bp-113-csp-cleanup-schedule | ☐ |

---

### i) Code Review Checklist

- [ ] docker-compose.yml has no `name:` or `container_name:` directives
- [ ] docker-compose.test.yml has no `container_name:` directive
- [ ] `CONTAINER_NETWORK` uses `${COMPOSE_PROJECT_NAME:-vibecode}_default`
- [ ] Jenkinsfile has no `disableConcurrentBuilds()`
- [ ] Jenkinsfile sets `COMPOSE_PROJECT_NAME` per build
- [ ] helpers.sh `docker_exec` maps all known container names to service names
- [ ] Fallback to raw `docker exec` works when compose unavailable
- [ ] Local dev: `docker compose up --build` still works
- [ ] No backend/frontend code changes

---

### j) Post-Deploy Verification

1. [ ] Local dev: `docker compose up --build` works
2. [ ] CI: integration tests pass
3. [ ] CI: two concurrent builds don't collide
4. [ ] No regressions in existing tests

---

*Fill in all sections before starting implementation.*
