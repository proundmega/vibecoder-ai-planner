# 01_ARCHITECT_REQUIREMENT.md — Docker Health Checks

**Status**: planned
**Date created**: 2026-06-17
**Author**: AI Assistant

---

## Requirement

Docker containers must have health checks to enable automatic restart on failure and proper startup ordering.

---

## Scope

- Add health check to backend service (API endpoint)
- Add health check to frontend service (HTTP 200 on /)
- Add health check to PostgreSQL service
- Update docker-compose to use health checks for startup ordering

---

## Assumptions

- `docker-compose.yml` already exists and defines `db`, `api`, and `frontend` services
- PostgreSQL health check can use `pg_isready` command (available in PostgreSQL Docker images)
- The backend already has a `/health` endpoint (confirmed by `src/api/routes.js` mounting `/health`)
- The frontend is served by nginx in production (confirmed by `frontend/Dockerfile`)
- Docker Compose v2+ syntax is used (supports `healthcheck` with `start_period`)
- No orchestrator (Kubernetes, ECS) is managing these containers — raw Docker Compose only

---

## Important Design Decisions

**These decisions MUST be confirmed by the user before implementation. Do NOT proceed without answers.**

1. **What should the backend health endpoint return?**
   - Simple: `GET /health` returns `{"status": "ok"}`
   - Detailed: `GET /health` returns DB connection status, uptime, memory

2. **Should health checks include DB connectivity?**
   - Yes — verify PostgreSQL is reachable
   - No — just check Node.js is alive

3. **What health check interval?**
   - 10s interval, 5s timeout, 3s start period
   - Or something else?

---

## Acceptance Criteria

- [ ] Backend service (`api`) has a `healthcheck` in `docker-compose.yml` using `curl` or `wget` to `http://localhost:3001/health`
- [ ] Backend health check has `interval`, `timeout`, `retries`, and `start_period` configured
- [ ] Frontend service (`frontend`) has a `healthcheck` using `curl` or `wget` to `http://localhost:3000/`
- [ ] PostgreSQL service (`db`) has a `healthcheck` using `pg_isready` command
- [ ] `depends_on` in docker-compose uses `condition: service_healthy` for startup ordering
- [ ] Backend health check returns HTTP 200 when the API is running and healthy
- [ ] Backend health check returns non-200 when PostgreSQL is unreachable (if DB connectivity check is enabled)
- [ ] Containers automatically restart after 3 consecutive health check failures
- [ ] `docker compose config` validates the compose file without errors
- [ ] `docker compose up --build` starts all services in correct order without errors

---

## Out of Scope

- Health check endpoints in the application code (only the docker-compose healthcheck config is in scope; `/health` endpoint already exists)
- Kubernetes health probes (liveness, readiness, startup probes — separate orchestration concern)
- Custom health check scripts or agents
- Health check alerting (PagerDuty, Slack notifications)
- Health check metrics export (Prometheus `/metrics` — separate concern)
- Database-level health checks (pg_isready is sufficient; no custom SQL queries needed)

---

## Testing Checklist

- [ ] Backend health check returns 200
- [ ] Frontend health check returns 200
- [ ] PostgreSQL health check returns 0 (success)
- [ ] Containers restart on health check failure
- [ ] Startup order respects health checks

---

## CI Requirements (MANDATORY)

- `npm test` — backend unit tests must pass
- `docker compose up --build` — Docker build succeeds
- `docker compose config` — compose file is valid

---

## Anti-Patterns to Avoid

- ❌ Health check that always returns 200 (doesn't detect failures)
- ❌ Health check that checks too much (slow, causes false positives)
- ❌ No start period (container restarts before it's ready)

---

*Ready for design phase.*
