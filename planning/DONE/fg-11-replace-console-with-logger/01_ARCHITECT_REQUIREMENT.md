# 01_ARCHITECT_REQUIREMENT.md — Replace console.error with Winston Logger

**Status**: planned
**Date created**: 2026-06-29
**Author**: AI Assistant
**Scope**: Backend, Frontend
**Priority**: P2
**Effort**: Medium

---

## Requirement

Several PRs introduced `console.error()` calls in backend route handlers and frontend API client code. The backend should use the project's winston logger for consistency with monitoring/observability. The frontend should use consistent error handling patterns.

**Backend occurrences:**
| PR | Location | Lines |
|----|----------|-------|
| 4, 5 | `backend/src/api/v1/agentHeartbeat.js` | 3 console.error calls |
| 10 | `frontend/src/views/ProjectMilestones.vue` | 3 console.error calls |
| 11 | `frontend/src/views/ProjectMilestones.vue` | 3 console.error calls |
| 12 | `frontend/src/views/ComputeNodes.vue` | 5 console.error calls |

**Note**: The agentHeartbeat.js console.error calls are addressed in fg-08. This ticket focuses on the remaining frontend occurrences.

---

## Existing Infrastructure Audit

### Backend API Check
- [x] Logger exists: `backend/src/utils/logger.js` or winston — YES, configured in backend

### Key Insight
The backend console.errors in agentHeartbeat.js are covered by ticket fg-08. This ticket addresses frontend console.error calls in milestone and compute node components.

---

## Scope

### In Scope
- Replace `console.error` in `frontend/src/views/ProjectMilestones.vue` with user-facing error state handling
- Replace `console.error` in `frontend/src/views/ComputeNodes.vue` with user-facing error state handling

### Out of Scope
- Backend console.error → logger (handled by fg-08)

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `frontend/src/views/ProjectMilestones.vue` | MODIFY | Replace console.error with error state refs + template display |
| `frontend/src/views/ComputeNodes.vue` | MODIFY | Replace console.error with error state refs + template display |

---

## Acceptance Criteria

1. [ ] [Frontend] Milestone list/detail views show error messages inline instead of console.error
2. [ ] [Frontend] Compute node list/detail views show error messages inline instead of console.error
3. [ ] [Frontend] Error states handle loading/empty/error consistently with other views
4. [ ] [Frontend] `npm run lint` passes
5. [ ] [Frontend] `npm test -- --run` passes
