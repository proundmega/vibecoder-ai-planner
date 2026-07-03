# 01_ARCHITECT_REQUIREMENT.md — CI & Docker Infrastructure Hardening

**Status**: planned
**Priority**: P2
**Effort**: Medium
**Scope**: Both

---

## Requirement

Fix CI pipeline inefficiencies, Docker build issues, and container infrastructure problems.

### Issues Addressed

| # | Issue | Severity | Location |
|---|-------|----------|----------|
| 1 | Frontend tests run in backend CI job (no parallelization) | HIGH | `.github/workflows/ci.yml:49-55` |
| 2 | CI uses outdated `actions/checkout@v3` and `setup-node@v3` | HIGH | `.github/workflows/ci.yml:29,33,65,69` |
| 3 | No Docker image builds in CI | HIGH | `.github/workflows/ci.yml` |
| 4 | No Java agent build or test in CI | HIGH | `.github/workflows/ci.yml` |
| 5 | Backend Dockerfile: wasted builder stage, duplicated npm ci, runs as root | HIGH | `backend/Dockerfile` |
| 6 | Agent Dockerfile hardcodes JAR version (`agent-1.0.0.jar`) | HIGH | `agent/Dockerfile:15` |
| 7 | Agent compose `depends_on` references service from different file | HIGH | `agent/docker-compose.yml:18-19` |
| 8 | Network name mismatch: `CONTAINER_NETWORK=vibecode_default` but compose generates `vibecoder-ai-planner_default` | HIGH | `docker-compose.yml:31` |
| 9 | No container resource limits for any service | MEDIUM | `docker-compose.yml` |
| 10 | API healthcheck `start_period: 10s` may be too short | MEDIUM | `docker-compose.yml:45` |
| 11 | Agent compose missing `condition: service_healthy` for api depends_on | MEDIUM | `agent/docker-compose.yml:18-19` |

---

## Scope

### In Scope
**CI:**
- Move frontend tests from backend CI job to frontend CI job
- Update `actions/checkout@v4` and `actions/setup-node@v4`
- Add Docker image build steps (backend + frontend) to CI
- Add Java agent build and test job to CI (`mvn test` + `mvn package`)

**Backend Dockerfile:**
- Remove wasteful `npm install --production` from builder stage
- Use `npm ci --omit=dev` (not deprecated `--only=production`)
- Add `USER node` for non-root container
- Proper layer caching (copy `package*.json` before source code)

**Agent Dockerfile:**
- Use wildcard for JAR copy (`agent-*.jar`) instead of hardcoded version

**Docker Compose:**
- Add top-level `name: vibecode` to fix network naming
- Add `deploy.resources.limits` for all services
- Increase API healthcheck `start_period` to 30s
- Add `condition: service_healthy` to agent compose api depends_on
- Document that agent compose must be used with root compose

### Out of Scope
- Full CI pipeline redesign
- Adding deployment steps
- Kubernetes/ECS migration

---

## Impact Analysis

| Component | Change Type |
|-----------|-------------|
| `.github/workflows/ci.yml` | MODIFY |
| `backend/Dockerfile` | MODIFY |
| `agent/Dockerfile` | MODIFY |
| `docker-compose.yml` | MODIFY |
| `agent/docker-compose.yml` | MODIFY |

---

## Acceptance Criteria

1. [ ] Frontend tests run in frontend CI job, in parallel with backend job
2. [ ] CI uses `actions/checkout@v4` and `actions/setup-node@v4`
3. [ ] CI builds backend + frontend Docker images
4. [ ] CI builds and tests Java agent (`mvn test` + `mvn package`)
5. [ ] Backend Docker image is ~50% smaller (correct multi-stage)
6. [ ] Backend container runs as non-root user
7. [ ] Agent Dockerfile uses `agent-*.jar` glob
8. [ ] `docker compose up` creates network named `vibecode_default`
9. [ ] All services have memory limits
10. [ ] API healthcheck has 30s start period
11. [ ] Agent compose works correctly with `-f agent/docker-compose.yml` flag
