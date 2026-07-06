# 01_ARCHITECT_REQUIREMENT.md — Schedule Stale Agent Cleanup

**Status**: planned
**Date created**: 2026-06-29
**Author**: AI Assistant
**Scope**: Backend
**Priority**: P1
**Effort**: Small

---

## Requirement

`HeartbeatService.cleanupStaleAgents()` exists and has tests, but is never called by any scheduler. Agents that crash or disconnect will remain marked `online` forever. The backend needs to periodically call this method (e.g., every 60 seconds via setInterval) to mark agents as `offline` and release any tickets they were working on.

---

## Existing Infrastructure Audit

### Backend API Check
- [x] Service exists: `backend/src/services/HeartbeatService.js` — YES (has `cleanupStaleAgents()` method)
- [x] Tests exist: `backend/src/__tests__/heartbeatService.test.js` — YES (cleanupStaleAgents tests)
- [x] Shutdown hooks: `backend/src/utils/shutdown.js` — YES (has cleanupHooks parameter)
- [ ] Scheduler exists: NO — must add a periodic timer

### Key Insight
The cleanup method is fully implemented and tested. The only missing piece is a periodic invocation. This is a SMALL backend change.

---

## Scope

### In Scope
- Add a `setInterval` in the backend entry point (`backend/src/index.js`) to call `HeartbeatService.cleanupStaleAgents()` every 60 seconds
- Use the existing `gracefulShutdown` cleanupHooks to clear the interval on shutdown

### Out of Scope
- Changes to HeartbeatService itself
- Changes to how stale detection works (60s threshold in the SQL is fine)

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/index.js` | MODIFY | Add require + setInterval for cleanupStaleAgents |
| `backend/src/services/HeartbeatService.js` | NONE | Already implemented |

---

## Acceptance Criteria

1. [ ] [Backend] `cleanupStaleAgents()` is called every 60 seconds via setInterval
2. [ ] [Backend] The interval is cleared during shutdown via cleanupHooks
3. [ ] [Backend] No errors thrown on first call (if no agents exist)
4. [ ] [Backend] Agents are marked offline after 60s of no heartbeat
5. [ ] [Backend] Tickets are released for stale agents that had a current_ticket_id
6. [ ] [Backend] `npm test` passes

---

## Security Considerations

- [ ] Authentication required: NO — runs internally, no exposure
- [ ] Rate limiting: N/A
