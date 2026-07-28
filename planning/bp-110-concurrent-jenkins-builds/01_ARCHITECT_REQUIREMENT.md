# 01_ARCHITECT_REQUIREMENT.md — Concurrent Jenkins Builds

**Status**: planned
**Date created**: 2026-07-28
**Date completed**: TBD
**Author**: AI Assistant
**Scope**: Backend (CI infrastructure)
**Priority**: P2
**Effort**: Medium

---

## Requirement

When multiple Jenkins jobs run concurrently on the same agent, Docker Compose containers collide because they share the same project name (`vibecode`), hardcoded container names (`vibecode-postgres`, `vibecode-api`, etc.), network name (`vibecode`), and host port bindings (5432, 6379, 3001). The second job fails because the first job's containers occupy the names and ports.

This ticket enables concurrent Jenkins builds by:
1. Using `COMPOSE_PROJECT_NAME` to give each build its own Docker namespace
2. Removing hardcoded container names from docker-compose files
3. Updating bash integration tests to resolve containers via compose project
4. Removing `disableConcurrentBuilds()` from Jenkinsfile

---

## Existing Infrastructure Audit

### Backend API Check
- N/A — no backend code changes

### Frontend API Client Check
- N/A — no frontend code changes

### Docker Compose Check
- [x] `docker-compose.yml`: Has `name: vibecode` and 6 hardcoded `container_name:` directives
- [x] `docker-compose.override.yml`: Has port overrides (no container names)
- [x] `docker-compose.test.yml`: Has `container_name: vibecode-test`
- [x] Network: Named `vibecode`, used by `CONTAINER_NETWORK=vibecode_default` in api env

### Jenkinsfile Check
- [x] `disableConcurrentBuilds()` on line 7
- [x] Docker compose commands use `-f ${DOCKER_COMPOSE_FILE}` already
- [x] Integration test stage: writes `.env`, builds/starts stack, exec's into test container

### Bash Integration Test Check
- [x] `helpers.sh`: `docker_exec` function uses `docker exec "$container"` with hardcoded names
- [x] 18 references to `vibecode-postgres`, `vibecode-redis`, `vibecode-pgbouncer` across test files
- [x] Tests run inside test container via `docker exec -w /app vibecode-test bash -c '...'`

### Key Insight

**This is a CI infrastructure change — no backend, frontend, or agent code changes.** The only code change is in `helpers.sh` (bash helper function). Everything else is in compose files and Jenkinsfile.

---

## Scope

### In Scope
- Remove `name: vibecode` from docker-compose.yml
- Remove all `container_name:` directives from docker-compose*.yml
- Set `COMPOSE_PROJECT_NAME` in Jenkinsfile (per-build unique)
- Update `CONTAINER_NETWORK` to use dynamic project name
- Update `docker_exec`/`docker_exec_out` in helpers.sh to use `docker compose exec`
- Remove `disableConcurrentBuilds()` from Jenkinsfile
- Mount compose files into test container for `docker compose exec`

### Out of Scope
- **Backend code changes** — PoolManager reads `CONTAINER_NETWORK` env var, already dynamic
- **Frontend code changes** — unaffected
- **Agent code changes** — unaffected
- **Local developer workflow** — unchanged (directory name used as project)
- **Port collision mitigation** — integration tests don't use host ports
- **Jenkins agent scaling** — separate concern

---

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-76 | Distributed tracing / OpenTelemetry spans | Observability | bp-110-distributed-tracing | ☐ |
| 2 | bp-106 | Log aggregation transport | Observability | bp-106-log-aggregation | ☐ |
| 3 | bp-101 | Configurable log rotation | Developer experience | bp-101-configurable-log-rotation | ☐ |
| 4 | bp-78 | CSP DB ingestion gap | Observability | bp-111-csp-db-ingestion | ☐ |
| 5 | bp-78 | CSP router mount | Bug fix | bp-112-csp-router-mount | ☐ |
| 6 | bp-78 | CSP cleanup scheduling | Bug fix | bp-113-csp-cleanup-schedule | ☐ |

---

## Deferred Improvements Found (Internal Tracking)

| # | From Ticket | Improvement | Category | Suggested Next Ticket |
|---|-------------|-------------|----------|----------------------|
| 1 | bp-76 | Distributed tracing | Observability | bp-110-distributed-tracing |
| 2 | bp-106 | Log aggregation | Observability | bp-106-log-aggregation |
| 3 | bp-101 | Configurable log rotation | Developer experience | bp-101-configurable-log-rotation |
| 4 | bp-78 | CSP DB ingestion | Observability | bp-111-csp-db-ingestion |
| 5 | bp-78 | CSP router mount | Bug fix | bp-112-csp-router-mount |
| 6 | bp-78 | CSP cleanup scheduling | Bug fix | bp-113-csp-cleanup-schedule |

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `docker-compose.yml` | MODIFY | Remove `name:`, 6 `container_name:`, network name, dynamic `CONTAINER_NETWORK` |
| `docker-compose.test.yml` | MODIFY | Remove `container_name:`, add compose mount + env var |
| `Jenkinsfile` | MODIFY | Remove `disableConcurrentBuilds()`, add `COMPOSE_PROJECT_NAME` |
| `backend/integration-test/helpers.sh` | MODIFY | Update `docker_exec`/`docker_exec_out` to use `docker compose exec` |
| `backend/` | NONE | No backend code changes |
| `frontend/` | NONE | No frontend code changes |
| `agent/` | NONE | No agent code changes |

---

## Known Unknowns

1. **docker compose CLI in test container**: The test container (Dockerfile.test) must have `docker compose` available. If not, the `docker_exec` fallback to raw `docker exec` handles this.
2. **Test container network access**: The test container must be on the same Docker network as other services. The `docker-compose.test.yml` already puts it on the `vibecode` network.
3. **Port collisions if someone publishes ports in CI**: Not an issue — integration tests access services by service name within the Docker network, not by host ports.

---

## Important Design Decisions

No design decisions require user input. All choices follow existing patterns:
- `COMPOSE_PROJECT_NAME` is the standard Docker Compose mechanism for project isolation
- `docker compose exec` is the standard replacement for hardcoded container names
- Local dev is unaffected (directory name used as default project)

---

## Acceptance Criteria

1. [ ] `docker-compose.yml` has no `name:` directive
2. [ ] `docker-compose*.yml` have no `container_name:` directives
3. [ ] `docker-compose.yml` network has no explicit `name:` (defaults to `${COMPOSE_PROJECT_NAME}_default`)
4. [ ] `CONTAINER_NETWORK` in api env uses `${COMPOSE_PROJECT_NAME}_default`
5. [ ] Jenkinsfile has no `disableConcurrentBuilds()`
6. [ ] Jenkinsfile sets `COMPOSE_PROJECT_NAME=vibecode-${BRANCH_NAME}-${BUILD_NUMBER}`
7. [ ] Test container has compose files mounted and `COMPOSE_PROJECT_NAME` env var
8. [ ] `helpers.sh` `docker_exec` resolves container names via `docker compose exec`
9. [ ] Local dev: `docker compose up --build` still works
10. [ ] Two concurrent Jenkins builds don't collide

---

## Out of Scope

- Backend code changes (PoolManager already reads env vars)
- Frontend code changes
- Agent code changes
- Local developer workflow changes
- Jenkins agent scaling
- Port collision mitigation (not needed for integration tests)

---

## Performance Considerations

- `docker compose exec` adds ~100ms overhead vs raw `docker exec` (negligible for tests)
- No impact on build times
- Concurrent builds reduce wall-clock time for multiple PRs

---

## Security Considerations

- [x] No new secrets or credentials
- [x] No changes to auth/permissions
- [x] Docker socket access unchanged

---

## Testing Checklist

### Backend Tests
- [ ] No backend code changes — existing tests unaffected

### Integration Tests
- [ ] Bash integration suite passes with dynamic project name
- [ ] `docker compose exec` resolves containers correctly
- [ ] Fallback to raw `docker exec` works when compose unavailable

### CI Verification
- [ ] Two concurrent Jenkins builds on same agent don't collide
- [ ] Each build has isolated containers, network, and volumes

---

## Anti-Patterns to Avoid

- ❌ **Hardcoding container names** — use `docker compose exec` with service names
- ❌ **Setting `COMPOSE_PROJECT_NAME` in docker-compose.yml** — must come from environment
- ❌ **Removing host ports from docker-compose.yml** — only skip in CI
- ❌ **Changing PoolManager.js** — already reads `CONTAINER_NETWORK` env var dynamically

---

*Fill in all sections before starting implementation.*
