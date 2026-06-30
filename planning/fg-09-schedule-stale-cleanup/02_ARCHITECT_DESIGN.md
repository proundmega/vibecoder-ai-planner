# 02_ARCHITECT_DESIGN.md — Schedule Stale Agent Cleanup

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

When an agent crashes or disconnects, its heartbeat stops, but the `agent_heartbeats` table still shows it as `online`. The `cleanupStaleAgents()` method exists in HeartbeatService to handle this — it marks agents as `offline` if `last_seen < NOW() - INTERVAL '60 seconds'` and releases any tickets — but this method is never invoked. Stale agents accumulate until manually cleaned up.

---

## Current State

- `HeartbeatService.cleanupStaleAgents()` — implemented and tested
- `backend/src/index.js` — no scheduled tasks
- `backend/src/utils/shutdown.js` — has cleanupHooks parameter for graceful shutdown

### Gap Analysis
- Cleanup logic exists but never runs
- Frontend polls agent status every 10s but stale agents stay "online" forever

---

## Design

### Option A: setInterval in index.js (Recommended)

Add a `setInterval` in `backend/src/index.js` after the server starts, passing a cleanup function to the shutdown hooks to clear the interval on shutdown.

### Option B: Use a separate cron job
- **Cons**: Requires external cron infrastructure
- **Decision**: Not worth the complexity for a 60s periodic task

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/index.js` | MODIFY | Add `require` for HeartbeatService, `setInterval(cleanupStaleAgents, 60000)`, pass clearInterval to cleanupHooks |

---

## Data Flow

```
[setInterval every 60s] → [HeartbeatService.cleanupStaleAgents()] → [UPDATE agent_heartbeats SET status='offline'] → [TicketService.releaseTicket() for each stale agent] → [tickets released for reprocessing]
```

---

## Security Considerations

- No authentication needed (internal process)
- Ticket release for stale agents is a safety feature, not a risk
