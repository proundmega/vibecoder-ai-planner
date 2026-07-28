# 04_SPECIFICATION.md — Concurrent Jenkins Builds

**Use this file when a small model (7B–34B) will execute the ticket.**
This file bridges the planning docs (01–03) and the code. It specifies exact file operations, imports, function signatures, test expectations, and edge cases.

**Generated from**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`
**Target model**: 34B local model
**Date**: 2026-07-28

---

## Test-First Requirement

**Test stub files MUST be created before any production code.**

This is a CI infrastructure change — no unit test stubs needed. The verification is:
1. Local dev: `docker compose up --build` still works
2. CI: integration tests pass with dynamic project name
3. CI: two concurrent builds don't collide

---

## File Operations

### MODIFY: `docker-compose.yml`

**Remove** line 1: `name: vibecode`

**Remove** all `container_name:` lines:
- Line 6: `container_name: vibecode-docker-proxy`
- Line 33: `container_name: vibecode-migrate`
- Line 57: `container_name: vibecode-api`
- Line 102: `container_name: vibecode-frontend`
- Line 127: `container_name: vibecode-redis`
- Line 146: `container_name: vibecode-postgres`
- Line 169: `container_name: vibecode-pgadmin`

**Change** api environment variable:
```yaml
# FROM:
- CONTAINER_NETWORK=vibecode_default
# TO:
- CONTAINER_NETWORK=${COMPOSE_PROJECT_NAME:-vibecode}_default
```

**Change** network definition:
```yaml
# FROM:
networks:
  vibecode:
    driver: bridge
# TO:
networks:
  default:
    driver: bridge
```

**Also update** all service `networks:` references from `vibecode` to `default`:
```yaml
# FROM:
    networks:
      - vibecode
# TO:
    networks:
      - default
```

### MODIFY: `docker-compose.test.yml`

**Remove** line 16: `container_name: vibecode-test`

**Add** `COMPOSE_PROJECT_NAME` environment variable to test service:
```yaml
    environment:
      - COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-vibecode}
```

**Add** compose file mount to test service volumes:
```yaml
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - .:/app/compose:ro
```

### MODIFY: `Jenkinsfile`

**Remove** line 7:
```groovy
        disableConcurrentBuilds()
```

**Add** to `environment` block (after `ENCRYPTION_KEY`):
```groovy
        COMPOSE_PROJECT_NAME = "vibecode-${BRANCH_NAME}-${BUILD_NUMBER}"
```

**Modify** Integration Tests stage — replace `docker exec -w /app vibecode-test` with `docker compose exec`. Change the Jest integration test step from:
```groovy
sh '''
    docker exec -w /app vibecode-test bash -c '
        OUTPUT=$(./node_modules/.bin/jest --config jest.integration.config.js --verbose 2>&1)
        echo "$OUTPUT"
        if echo "$OUTPUT" | grep -E "^(Test Suites:|Tests:)" | grep -qi "failed"; then
            exit 1
        fi
    '
'''
```
To:
```groovy
sh '''
    docker compose -f ${DOCKER_COMPOSE_FILE} -f docker-compose.test.yml exec -T test bash -c '
        cd /app
        OUTPUT=$(./node_modules/.bin/jest --config jest.integration.config.js --verbose 2>&1)
        echo "$OUTPUT"
        if echo "$OUTPUT" | grep -E "^(Test Suites:|Tests:)" | grep -qi "failed"; then
            exit 1
        fi
    '
'''
```

**Same change** for the bash integration test step from:
```groovy
sh '''
    docker exec -w /app vibecode-test bash -c '
        set -x
        BASE_URL=http://api:3001 bash integration-test/run.sh --only 2>&1
        EXIT_CODE=$?
        echo "--- bash test exit code: $EXIT_CODE ---"
        exit $EXIT_CODE
    '
'''
```
To:
```groovy
sh '''
    docker compose -f ${DOCKER_COMPOSE_FILE} -f docker-compose.test.yml exec -T test bash -c '
        cd /app
        set -x
        BASE_URL=http://api:3001 bash integration-test/run.sh --only 2>&1
        EXIT_CODE=$?
        echo "--- bash test exit code: $EXIT_CODE ---"
        exit $EXIT_CODE
    '
'''
```

### MODIFY: `backend/integration-test/helpers.sh`

**Replace** the `docker_exec()` function (lines 15-25) with:

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

**Replace** the `docker_exec_out()` function (lines 29-38) with:

```bash
docker_exec_out() {
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
  local output
  # Try docker compose exec first
  if [ -f /app/compose/docker-compose.yml ]; then
    local compose_args="-f /app/compose/docker-compose.yml"
    [ -f /app/compose/docker-compose.test.yml ] && compose_args="$compose_args -f /app/compose/docker-compose.test.yml"
    output=$(docker compose $compose_args exec -T "$service" "$@" 2>/dev/null) && { echo "$output"; return 0; }
  fi
  # Fallback: direct docker exec
  output=$(docker exec "$container" "$@" 2>/dev/null) && { echo "$output"; return 0; }
  if command -v sudo >/dev/null 2>&1; then
    output=$(sudo docker exec "$container" "$@" 2>/dev/null) && { echo "$output"; return 0; }
  fi
  echo "docker_exec_out: failed to execute on container '$container': $*" >&2
  return 1
}
```

---

## Test Expectations

### Verification Checklist
```
✓ [local] docker compose up --build starts all services
✓ [local] API health check passes: curl http://localhost:3001/api/health
✓ [local] Frontend loads: curl http://localhost:3000
✓ [ci] Integration tests pass with dynamic project name
✓ [ci] Two concurrent builds on same agent don't collide
✓ [ci] Container names are prefixed with COMPOSE_PROJECT_NAME
```

### Edge Cases to Verify
```
✓ [edge] Same branch, two builds: different BUILD_NUMBER → unique project name
✓ [edge] Master builds: COMPOSE_PROJECT_NAME=vibecode-master-${BUILD_NUMBER}
✓ [edge] helpers.sh fallback: raw docker exec works when compose files unavailable
```

---

## Edge Cases to Handle

1. **Test container missing docker compose CLI**: Fallback in `docker_exec` to raw `docker exec`
2. **Compose files not mounted**: Fallback path handles missing `/app/compose/docker-compose.yml`
3. **Same branch, concurrent builds**: Different `BUILD_NUMBER` ensures unique project name
4. **Local dev without COMPOSE_PROJECT_NAME**: `${COMPOSE_PROJECT_NAME:-vibecode}` defaults to `vibecode`

---

## Existing Code Patterns to Follow

- `docker compose -f ${DOCKER_COMPOSE_FILE}` pattern already used in Jenkinsfile
- `docker_exec` helper already exists in `helpers.sh` — we're extending it, not replacing
- `COMPOSE_PROJECT_NAME` is the standard Docker Compose mechanism

---

## Pending Scope Items

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-76 | Distributed tracing | Observability | bp-110-distributed-tracing | ☐ |
| 2 | bp-106 | Log aggregation | Observability | bp-106-log-aggregation | ☐ |
| 3 | bp-101 | Configurable log rotation | Developer experience | bp-101-configurable-log-rotation | ☐ |
| 4 | bp-78 | CSP DB ingestion | Observability | bp-111-csp-db-ingestion | ☐ |
| 5 | bp-78 | CSP router mount | Bug fix | bp-112-csp-router-mount | ☐ |
| 6 | bp-78 | CSP cleanup scheduling | Bug fix | bp-113-csp-cleanup-schedule | ☐ |

---

## Files NOT to Change

- `backend/src/**/*.js` — no backend code changes
- `frontend/src/**` — no frontend code changes
- `agent/src/**` — no agent code changes
- `docker-compose.override.yml` — local dev port overrides unchanged

---

*This specification is the contract between planning and execution. If the model cannot produce code matching this spec, it should request human feedback rather than guessing.*
