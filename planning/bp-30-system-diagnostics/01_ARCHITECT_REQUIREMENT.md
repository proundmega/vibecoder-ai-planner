# bp-30: System Diagnostics — One-Click Health Check

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Both
**Priority**: P1
**Effort**: Medium

## Problem Statement

With many moving parts (backend, frontend, DB, agents, AI provider, GitHub credentials), when something breaks the user has no way to know what broke. The only system test is a CLI script (`backend/integration-test/run.sh`). There's no UI and no "Run Diagnostics" button.

## Scope

- **In scope**: Diagnostics backend service with fast checks (API health, DB, auth flow, planning system, credential store), slow checks (AI provider, agent liveness, GitHub), async runner with polling, frontend SystemDiagnostics.vue, dashboard link
- **Out of scope**: Full agent flow test (Phase 10 from DREAM — deferred), webhook receiver testing, performance benchmarking

## Acceptance Criteria

- [ ] POST /api/diagnostics/run starts async test run, returns run_id
- [ ] GET /api/diagnostics/status/:run_id returns step progress (running/passed/failed/error with duration_ms)
- [ ] 6 fast checks: Backend API, Database, Auth flow, Frontend, Planning system, Credential store
- [ ] 3 slow checks: AI Provider, Agent liveness, GitHub connection
- [ ] Checks run in parallel where possible (fast group) and sequentially where dependent
- [ ] Frontend SystemDiagnostics.vue shows step-by-step results with icons and timing
- [ ] "Run Tests" button, dropdown for "Extended" mode including slow checks
- [ ] Dashboard.vue shows summary link ("Last test: 6/8 passed")

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/services/DiagnosticsService.js` | CREATE | Check runner + step executor |
| `backend/src/api/diagnostics.js` | CREATE | Run + status endpoints |
| `backend/src/api/routes.js` | MODIFY | Mount diagnostics at /api (unversioned for simplicity) |
| `frontend/src/api/diagnostics.js` | CREATE | API client |
| `frontend/src/views/SystemDiagnostics.vue` | CREATE | Results table + controls |
| `frontend/src/router/index.ts` | MODIFY | Add /diagnostics route |
| `frontend/src/views/Dashboard.vue` | MODIFY | Add health summary link |

## Dependencies

- **Depends on**: bp-26 (phase machine — for planning system check), bp-29 (provider config — for AI provider check)
