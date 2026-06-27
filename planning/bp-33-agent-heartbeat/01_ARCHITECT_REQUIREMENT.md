# bp-33: Agent Heartbeat & Liveness

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Backend + Frontend + Agent
**Priority**: P1
**Effort**: Medium

## Problem Statement

There is no way to tell if an agent is alive or silently dead. When an agent crashes or loses network, its assigned ticket remains locked in `in_progress` indefinitely. No one notices until a human manually checks. This blocks the ticket forever and wastes time debugging phantom locks.

## Scope

### In Scope

- **Backend**: New DB table `agent_heartbeats` (migration 021), new `HeartbeatService.js`, new routes in `backend/src/api/agents.js` (POST heartbeat, GET agents with status, GET agent detail), periodic cleanup job (30s interval)
- **Agent**: New `sendHeartbeat()` method in `ApiService.java`, call every 30s in `AgentApp.java` processing loop
- **Frontend**: New `AgentList.vue` view at `/agents`, new `api/agents.js` client, agent detail view (inline or via `/agents/:id`), modify router, modify `Dashboard.vue` for agent summary

### Out of Scope

- WebSocket-based realtime updates (polling only)
- Graceful shutdown signal from agent
- Agent auto-restart on failure (pool manager — bp-36)
- Historical heartbeat data retention/purging

## Acceptance Criteria

- [ ] Migration 021 creates `agent_heartbeats` table with all specified columns
- [ ] `HeartbeatService.recordHeartbeat(agentId, ticketId, step, memory, cpu)` upserts heartbeat data
- [ ] `HeartbeatService.getAgentStatus(agentId)` returns latest heartbeat with status
- [ ] `HeartbeatService.getAllAgents()` returns all agents with computed status
- [ ] `HeartbeatService.cleanupStaleAgents()` marks agents offline if `last_seen > 60s ago`, releases their tickets
- [ ] `POST /api/v1/agents/:id/heartbeat` creates/updates heartbeat, returns `{ success: true }`
- [ ] `GET /api/v1/agents` returns list of agents with status (online/idle/offline), current ticket, actions today, cost
- [ ] `GET /api/v1/agents/:id` returns agent detail with action history
- [ ] Cleanup job runs every 30s via `setInterval`, marks stale agents offline, calls `TicketService.release()`
- [ ] Agent sends heartbeat POST every 30s in its main loop
- [ ] `frontend/src/views/AgentList.vue` renders at `/agents` with agent table/cards
- [ ] Frontend polls `GET /agents` every 10s
- [ ] `Dashboard.vue` shows agent summary: X online, Y idle, Z offline
- [ ] `/agents/:id` shows agent detail (history, cost, actions)

## Known Unknowns

- **Agent ID format**: Backend uses UUID for agent IDs. Agent on Java side uses its own `agentId` (could be hostname or UUID). Need alignment or use agent's API key to identify.
- **Ticket release on stale**: The `TicketService.release()` method may not exist yet — may need to implement it or call an existing release endpoint.
- **Agent process ID**: Agent may run in a containerized environment where multiple instances share the same agent database record. Heartbeat uses `agentId` from the registered agent record.

## Decisions Required

1. **How does the agent identify itself for heartbeat?**
   - Option A: Agent's database UUID (requires fetching `/api/agents/me` at startup)
   - Option B: Agent's API key (lookup on each heartbeat via `X-API-Key` header)
   - **Recommendation**: Option B — agent already has API key in headers; backend can lookup agent record on each heartbeat, no startup step needed

2. **Backend route placement for heartbeat?**
   - Option A: Add to existing `backend/src/api/agents.js` (unversioned `/api/agents`)
   - Option B: Add to v1 routes (`/api/v1/agents`)
   - **Recommendation**: Option B — all new endpoints should be versioned. Create a separate route module `backend/src/api/v1/agentHeartbeat.js` or add to existing agents route under v1.

3. **Cleanup job — server-wide singleton?**
   - Option A: Start in `backend/src/index.js` after DB connection
   - Option B: Start in a new module imported by index.js
   - **Recommendation**: Option A — simple `setInterval` in index.js with a named function, easy to find and debug

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/migrations/021_agent_heartbeats.sql` | CREATE | New table `agent_heartbeats` |
| `backend/src/migrations/021_agent_heartbeats_rollback.sql` | CREATE | Drop table |
| `backend/src/migrations/apply.js` | MODIFY | Add 021 to `SQL_FILES` array |
| `backend/src/services/HeartbeatService.js` | CREATE | 4 methods: record, getStatus, getAll, cleanup |
| `backend/src/api/v1/agentHeartbeat.js` | CREATE | Routes: POST heartbeat, GET agents, GET agent detail |
| `backend/src/api/v1/index.js` | MODIFY | Mount agentHeartbeat routes |
| `backend/src/index.js` | MODIFY | Start cleanup interval after DB pool ready |
| `agent/.../ApiService.java` | MODIFY | Add `sendHeartbeat()` method |
| `agent/.../AgentApp.java` | MODIFY | Add heartbeat call in main loop |
| `frontend/src/api/agents.js` | CREATE | API client for agent endpoints |
| `frontend/src/views/AgentList.vue` | CREATE | Agent list view |
| `frontend/src/views/AgentDetail.vue` | CREATE | Agent detail view |
| `frontend/src/router/index.ts` | MODIFY | Add `/agents` route |
| `frontend/src/views/Dashboard.vue` | MODIFY | Add agent summary section |
| `TicketService.js` | MAYBE MODIFY | Add `release()` if not exists |

## Dependencies

- **Depends on**: bp-24 (agent writes code — agent-side changes build on existing agent infrastructure)
- **Depends on this**: bp-36 (pool manager — uses heartbeat data for agent lifecycle)

## Performance Considerations

- Heartbeat writes are upserts (1 row per agent) — negligible load
- Frontend polls every 10s — lightweight, no WebSocket infra needed
- Cleanup job scans ~10-100 rows every 30s — trivial
- No indexing needed beyond PK on `agent_id`
