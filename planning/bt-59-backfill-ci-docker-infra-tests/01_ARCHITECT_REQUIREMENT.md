# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: planned
**Date created**: 2026-07-04
**Date completed**: {{YYYY-MM-DD}}
**Author**: AI Assistant
**Scope**: CI/CD | Docker
**Priority**: P1
**Effort**: Medium
**Related**: bp-59 (CI & Docker Infra) — from `planning/archived/bp-59-ci-docker-infra/`

---

## Requirement

bp-59 hardened CI pipeline and Docker infrastructure including:
- CI uses `actions/checkout@v4` and `actions/setup-node@v4`
- Docker image builds in CI (backend + frontend)
- Java agent build and test in CI
- Backend Dockerfile uses `USER node` (non-root)
- Backend Docker image size reduced by multi-stage build
- Agent Dockerfile uses `agent-*.jar` glob
- `docker compose up` creates network named `vibecode_default`
- All services have memory limits
- API healthcheck has 30s start period
- Agent compose works with `-f agent/docker-compose.yml`

However, none of these infrastructure changes have corresponding tests. Without tests, CI and Docker regressions are impossible to detect.

This ticket backfills all missing test coverage for the bp-59 CI/Docker infrastructure changes.

---

## Existing Infrastructure Audit

### CI Check
- [ ] `.github/workflows/ci.yml` — verify actions@v4, Docker builds, agent build
- [ ] Existing test patterns: `backend/src/__tests__/` — verify

### Docker Check
- [ ] `backend/Dockerfile` — verify `USER node`, multi-stage build
- [ ] `agent/Dockerfile` — verify `agent-*.jar` glob
- [ ] `docker-compose.yml` — verify network name, memory limits, healthcheck
- [ ] `agent/docker-compose.yml` — verify works with root compose
- [ ] Existing test patterns: `backend/src/__tests__/` — verify

### Key Insight

This is a **configuration verification** ticket. All production changes from bp-59 already exist. The task is to create tests that verify:
1. CI uses `actions/checkout@v4` and `actions/setup-node@v4`
2. Docker image builds in CI (backend + frontend)
3. Java agent build and test in CI
4. Backend Dockerfile uses `USER node`
5. Backend Docker image size reduced by multi-stage build
6. Agent Dockerfile uses `agent-*.jar` glob
7. `docker compose up` creates network named `vibecode_default`
8. All services have memory limits
9. API healthcheck has 30s start period
10. Agent compose works with `-f agent/docker-compose.yml`

---

## Scope

### In Scope
- Create `backend/src/__tests__/ciActionsVersion.test.js` — verify CI uses actions@v4
- Create `backend/src/__tests__/ciDockerBuilds.test.js` — verify Docker builds in CI
- Create `backend/src/__tests__/ciAgentBuild.test.js` — verify Java agent build in CI
- Create `backend/src/__tests__/dockerfileNonRoot.test.js` — verify `USER node`
- Create `backend/src/__tests__/dockerfileMultiStage.test.js` — verify multi-stage build
- Create `backend/src/__tests__/agentDockerfileGlob.test.js` — verify `agent-*.jar` glob
- Create `backend/src/__tests__/composeNetworkName.test.js` — verify `vibecode_default` network
- Create `backend/src/__tests__/composeMemoryLimits.test.js` — verify memory limits
- Create `backend/src/__tests__/composeHealthcheck.test.js` — verify 30s start period
- Create `backend/src/__tests__/agentComposeWorks.test.js` — verify agent compose compatibility

### Out of Scope
- Modifying any production code from bp-59
- Creating new CI workflows or Dockerfiles
- Changes to `.github/workflows/`, `docker-compose.yml`, or Dockerfiles

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/__tests__/ciActionsVersion.test.js` | CREATE | Verify actions@v4 |
| `backend/src/__tests__/ciDockerBuilds.test.js` | CREATE | Verify Docker builds in CI |
| `backend/src/__tests__/ciAgentBuild.test.js` | CREATE | Verify Java agent build |
| `backend/src/__tests__/dockerfileNonRoot.test.js` | CREATE | Verify USER node |
| `backend/src/__tests__/dockerfileMultiStage.test.js` | CREATE | Verify multi-stage build |
| `backend/src/__tests__/agentDockerfileGlob.test.js` | CREATE | Verify agent-*.jar glob |
| `backend/src/__tests__/composeNetworkName.test.js` | CREATE | Verify network name |
| `backend/src/__tests__/composeMemoryLimits.test.js` | CREATE | Verify memory limits |
| `backend/src/__tests__/composeHealthcheck.test.js` | CREATE | Verify 30s start period |
| `backend/src/__tests__/agentComposeWorks.test.js` | CREATE | Verify agent compose |

---

## Known Unknowns

1. **[CI workflow path]**: Exact path of CI workflow. Need to check `.github/workflows/ci.yml`.
2. **[Dockerfile paths]**: Exact paths of Dockerfiles. Need to check `backend/Dockerfile`, `agent/Dockerfile`.
3. **[Docker Compose paths]**: Exact paths of compose files. Need to check `docker-compose.yml`, `agent/docker-compose.yml`.

---

## Important Design Decisions

**No design decisions require user input. All choices follow existing patterns.**

---

## Acceptance Criteria

1. [ ] CI workflow uses `actions/checkout@v4` (not v3 or earlier)
2. [ ] CI workflow uses `actions/setup-node@v4` (not v3 or earlier)
3. [ ] CI workflow includes Docker image build steps for backend
4. [ ] CI workflow includes Docker image build steps for frontend
5. [ ] CI workflow includes Java agent build (`mvn package`)
6. [ ] CI workflow includes Java agent test (`mvn test`)
7. [ ] Backend Dockerfile contains `USER node`
8. [ ] Backend Dockerfile has multi-stage build (builder + production stage)
9. [ ] Agent Dockerfile uses `agent-*.jar` glob (not hardcoded version)
10. [ ] `docker-compose.yml` sets network name to `vibecode_default`
11. [ ] All services in compose have `deploy.resources.limits` or `mem_limit`
12. [ ] API service healthcheck has `start_period: 30s`
13. [ ] Agent compose file works with root compose (no conflicting service names)
14. [ ] `npm test` passes with no regressions
15. [ ] `npm run lint` passes

---

## Testing Checklist

### Backend Tests
- [ ] `backend/src/__tests__/ciActionsVersion.test.js` — CREATED
- [ ] `backend/src/__tests__/ciDockerBuilds.test.js` — CREATED
- [ ] `backend/src/__tests__/ciAgentBuild.test.js` — CREATED
- [ ] `backend/src/__tests__/dockerfileNonRoot.test.js` — CREATED
- [ ] `backend/src/__tests__/dockerfileMultiStage.test.js` — CREATED
- [ ] `backend/src/__tests__/agentDockerfileGlob.test.js` — CREATED
- [ ] `backend/src/__tests__/composeNetworkName.test.js` — CREATED
- [ ] `backend/src/__tests__/composeMemoryLimits.test.js` — CREATED
- [ ] `backend/src/__tests__/composeHealthcheck.test.js` — CREATED
- [ ] `backend/src/__tests__/agentComposeWorks.test.js` — CREATED

### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run lint` — no lint errors
- [ ] `npm run typecheck` — frontend typecheck passes
- [ ] `npm run build` — frontend build passes

---

## Anti-Patterns to Avoid

- ❌ **Testing only happy paths** — test CI config errors, Docker build failures
- ❌ **Creating new production code** — this is a test-only ticket
- ❌ **No regression test** — every new test must verify the specific bp-59 behavior
- ❌ **Skipping infrastructure tests** — CI and Docker changes must be verified

---

*Fill in all sections before starting implementation.*
