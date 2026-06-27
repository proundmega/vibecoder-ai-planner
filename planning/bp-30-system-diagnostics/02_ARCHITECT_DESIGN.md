# bp-30: System Diagnostics — Design

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Both

## Current State

No diagnostics system. Integration tests exist as bash scripts in `backend/integration-test/run.sh`. No API endpoint for health status beyond the basic `GET /api/health`.

## Proposed Solution

### DiagnosticsService

In-memory runner with async execution:

```javascript
class DiagnosticsService {
    runs = new Map();  // run_id → { status, steps[], createdAt }

    async run(mode) {
        // mode: "fast" | "extended"
        const runId = uuid.v4();
        const steps = buildStepList(mode);
        this.runs.set(runId, { status: 'running', steps, createdAt: Date.now() });

        // Independent fast steps run in parallel
        const fastSteps = steps.filter(s => s.group === 'fast');
        const slowSteps = steps.filter(s => s.group === 'slow');

        await Promise.all(fastSteps.map(s => this.executeStep(runId, s)));
        for (const step of slowSteps) {
            await this.executeStep(runId, step);
        }

        this.runs.get(runId).status = 'completed';
        return runId;
    }

    getStatus(runId) { return this.runs.get(runId); }
}
```

### Check Steps

**Fast checks:**
| Step | Group | Handler |
|------|-------|---------|
| 1. Backend API | fast | GET /api/health → check status: "ok" |
| 2. Database | fast | POST /api/v1/projects → create → delete project |
| 3. Auth flow | fast | Register → login → verify token |
| 4. Frontend | fast | GET http://localhost:3000/ (configurable) → check HTTP 200 |
| 5. Planning system | fast | GET project templates → verify list |
| 6. Credential store | fast | POST credential → GET decrypted → verify round-trip |

**Slow checks:**
| Step | Group | Handler |
|------|-------|---------|
| 7. AI Provider | slow | POST to configured AI endpoint → check response |
| 8. Agent liveness | slow | GET /api/v1/agents → check heartbeat recency |
| 9. GitHub connection | slow | GET linked repo → list branches |

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | /api/diagnostics/run | Start async test run (body: { mode }) |
| GET | /api/diagnostics/status/:runId | Poll for progress |

### Frontend: SystemDiagnostics.vue

```
+------------------------------------------------------------------+
|  🔬 System Diagnostics                  [Run Tests] [▼]          |
|  Last run: 2 minutes ago | Duration: 4.2s                        |
|                                                                   |
|  ✅ Backend API ................ 142ms  ✓ HTTP 200 + ok           |
|  ✅ Database ................... 231ms  ✓ Create/delete           |
|  ✅ Auth flow .................. 312ms  ✓ Register/login          |
|  ✅ Frontend ................... 89ms   ✓ HTTP 200                |
|  ⚠️ AI Provider ................ ✗ 8.4s  Connection refused       |
|  ❌ Agent liveness ............. ✗       No agents online         |
|                                                                   |
|  Summary: 4/6 passed, 1 warning, 1 failed                         |
+------------------------------------------------------------------+
```

Each row: icon (✅/⚠️/❌/⏳), name, duration, detail. Failed rows expandable for error details. "Run Tests" runs fast mode. "▼" dropdown includes "Run Extended".

### Dashboard Integration

In Dashboard.vue, a small card/section:
```
🩺 System Health — Last test: 4/6 passed [View Details →]
```

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/services/DiagnosticsService.js` | CREATE | Check runner with step definitions |
| `backend/src/api/diagnostics.js` | CREATE | POST run + GET status endpoints |
| `backend/src/api/routes.js` | MODIFY | Mount diagnostics router |
| `frontend/src/api/diagnostics.js` | CREATE | startDiagnostics, getDiagnosticsStatus |
| `frontend/src/views/SystemDiagnostics.vue` | CREATE | Full diagnostics table UI |
| `frontend/src/router/index.ts` | MODIFY | Add /diagnostics route |
| `frontend/src/views/Dashboard.vue` | MODIFY | Health summary card |

## Alternatives Considered

- **Alternative: Synchronous test run** — Rejected because AI provider tests can take 30s. Async with polling gives better UX.
- **Alternative: Store results in DB** — Rejected; in-memory is simpler and diagnostics data is ephemeral. Results survive page refresh via localStorage on frontend.
