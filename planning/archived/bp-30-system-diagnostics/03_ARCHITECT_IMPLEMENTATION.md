# bp-30: System Diagnostics — Implementation

**Status**: planned
**Priority**: P1
**Effort**: Medium
**Scope**: Both

## Purpose
One-click system health verification from the UI, replacing ssh-and-curl debugging.

## Implementation Order

1. **Create DiagnosticsService.js** — `backend/src/services/DiagnosticsService.js`
   - Step definitions with handlers for each check
   - Async runner with parallel fast steps + sequential slow steps
   - run(mode), getStatus(runId), executeStep()
   - *Depends on*: nothing (standalone service)

2. **Create diagnostics API routes** — `backend/src/api/diagnostics.js`
   - POST /api/diagnostics/run — body: { mode: "fast"|"extended" }
   - GET /api/diagnostics/status/:runId
   - *Depends on*: Step 1

3. **Mount diagnostics routes** — `backend/src/api/routes.js`
   - router.use('/diagnostics', diagnosticsRouter) — unversioned for easy access
   - *Depends on*: Step 2

4. **Create frontend API client** — `frontend/src/api/diagnostics.js`
   - *Depends on*: Step 2

5. **Create SystemDiagnostics.vue** — `frontend/src/views/SystemDiagnostics.vue`
   - Results table, run button, mode dropdown, poll loop
   - *Depends on*: Step 4

6. **Add /diagnostics route** — `frontend/src/router/index.ts`
   - *Depends on*: Step 5

7. **Add health summary to Dashboard.vue** — `frontend/src/views/Dashboard.vue`
   - *Depends on*: Step 4

## Per-File Action Plan

### `backend/src/services/DiagnosticsService.js` (CREATE)
- Map of check definitions with handler functions
- `async run(mode)` — creates run, executes steps, returns runId
- `getStatus(runId)` — returns current state
- Steps use axios to call internal endpoints (localhost)
- Store results in Map<runId, { status, steps[], createdAt }>

### `backend/src/api/diagnostics.js` (CREATE)
- POST /run → returns { run_id, status: "running" }
- GET /status/:runId → returns { run_id, status, steps[], createdAt }

### `frontend/src/api/diagnostics.js` (CREATE)
- `startDiagnostics(mode)` → POST /api/diagnostics/run
- `getDiagnosticsStatus(runId)` → GET /api/diagnostics/status/:runId

### `frontend/src/views/SystemDiagnostics.vue` (CREATE)
- State: runId, results[], running, lastResult (from localStorage)
- Method runTests(mode): start → poll every 1s → stop when complete
- Method loadLastResult: from localStorage on mount
- Template: results table with icons, durations, expandable errors

### `frontend/src/router/index.ts` (MODIFY)
- Add route: `/diagnostics` → SystemDiagnostics, meta: { requiresAuth: true }

### `frontend/src/views/Dashboard.vue` (MODIFY)
- Add section: "System Health" with last run summary + link to /diagnostics

## Test Plan
1. POST /api/diagnostics/run with mode=fast → verify 202 with run_id
2. Poll GET /api/diagnostics/status/:runId → verify steps complete
3. Each step individually: Backend health, DB, Auth, etc.
4. Frontend: click Run Tests → see progress → see results
5. Verify results persist in localStorage across page reload

## Rollback Steps
1. Remove diagnostics routes from routes.js
2. Remove SystemDiagnostics.vue
3. Remove route from router/index.ts
4. Remove dashboard link
