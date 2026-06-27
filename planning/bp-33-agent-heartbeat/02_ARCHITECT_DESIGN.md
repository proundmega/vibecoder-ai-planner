# bp-33: Agent Heartbeat & Liveness — Design

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Backend + Frontend + Agent

## Current State

Agents communicate with the backend via REST API (ApiService.java) for ticket operations (pickup, release, status update, messaging). There is no liveness mechanism. If an agent crashes:
1. The backend has no way to detect it
2. The ticket stays locked with `assigned_agent` set and status `in_progress`
3. No other agent can pick up the ticket
4. No human is alerted

The `agents` table has agent records with API keys but no liveness columns.

## Proposed Solution

### Approach

Add a heartbeat table and service. Agents POST heartbeat every 30s. Backend tracks `last_seen` and runs a periodic cleanup job (every 30s) that marks agents as offline if their heartbeat is >60s stale. Stale agents' tickets are auto-released.

Frontend polls `GET /agents` every 10s and displays agent status in a new AgentList view and Dashboard summary.

### Data Flow

```
Agent (every 30s)
  → POST /api/v1/agents/:agentId/heartbeat
    Request: { current_ticket_id?, current_step?, memory_usage?, cpu_usage? }
    Response: { success: true }

Backend (every 30s, setInterval)
  → HeartbeatService.cleanupStaleAgents()
    SELECT * FROM agent_heartbeats WHERE last_seen < NOW() - INTERVAL '60 seconds' AND status = 'online'
    UPDATE agent_heartbeats SET status = 'offline'
    For each agent with current_ticket_id:
      TicketService.release(current_ticket_id)
      UPDATE agent_heartbeats SET current_ticket_id = NULL

Frontend (every 10s)
  → GET /api/v1/agents
    Response: [{ agentId, name, status, currentTicket, actionsToday, costToday }]
  → Render AgentList.vue table

Frontend (on mount or click)
  → GET /api/v1/agents/:id
    Response: { agentId, name, status, history: [...], totalCost, totalActions }
```

### Heartbeat DB Schema (Migration 021)

```sql
CREATE TABLE agent_heartbeats (
    agent_id VARCHAR(64) PRIMARY KEY,
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    current_ticket_id UUID REFERENCES tickets(id),
    current_step VARCHAR(64),
    memory_usage JSONB,
    cpu_usage JSONB,
    status VARCHAR(16) NOT NULL DEFAULT 'online'
);
```

### HeartbeatService.js

```javascript
class HeartbeatService {
  async recordHeartbeat(agentId, { ticketId, step, memory, cpu })
    → UPSERT into agent_heartbeats

  async getAgentStatus(agentId)
    → SELECT * FROM agent_heartbeats WHERE agent_id = $1

  async getAllAgents()
    → JOIN agent_heartbeats with agents table + agent_actions for daily stats
    → Returns: agentId, name, status, currentTicket, actionsToday, costToday

  async cleanupStaleAgents()
    → UPDATE status='offline' WHERE last_seen < NOW() - INTERVAL '60s' AND status='online'
    → For each stale agent with current_ticket_id, call ticketService.release()
}
```

### Backend Route Changes

New route module: `backend/src/api/v1/agentHeartbeat.js`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/v1/agents/:id/heartbeat` | X-API-Key | Record heartbeat |
| `GET` | `/api/v1/agents` | JWT | List agents with status |
| `GET` | `/api/v1/agents/:id` | JWT | Agent detail + history |

The heartbeat endpoint is authenticated via `X-API-Key` (agent-side). The list and detail endpoints are JWT-authenticated (UI-side).

### Cleanup Job

In `backend/src/index.js`, after database pool is initialized:

```javascript
const HEARTBEAT_CLEANUP_INTERVAL = 30000; // 30s
const HeartbeatService = require('./services/HeartbeatService');

async function cleanupStaleAgents() {
  try {
    const count = await HeartbeatService.cleanupStaleAgents();
    if (count > 0) {
      logger.info(`Cleaned up ${count} stale agent(s)`);
    }
  } catch (err) {
    logger.error('Heartbeat cleanup failed', err);
  }
}

const cleanupInterval = setInterval(cleanupStaleAgents, HEARTBEAT_CLEANUP_INTERVAL);
// Store interval ref for graceful shutdown
```

### Agent-Side Changes

**ApiService.java** — add method:
```java
public void sendHeartbeat(String agentId, String ticketId, String step,
    Map<String, Object> memoryUsage, Map<String, Object> cpuUsage) throws IOException {
  String url = baseUrl + "/agents/" + agentId + "/heartbeat";
  Map<String, Object> body = new HashMap<>();
  if (ticketId != null) body.put("current_ticket_id", ticketId);
  if (step != null) body.put("current_step", step);
  if (memoryUsage != null) body.put("memory_usage", memoryUsage);
  if (cpuUsage != null) body.put("cpu_usage", cpuUsage);
  executePost(url, body, ...);
}
```

**AgentApp.java** — in the main loop (after ticket processing or as a background timer):
```java
ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(1);
scheduler.scheduleAtFixedRate(() -> {
  try {
    Map<String, Object> mem = Map.of("free", Runtime.getRuntime().freeMemory(),
      "total", Runtime.getRuntime().totalMemory(), "max", Runtime.getRuntime().maxMemory());
    Map<String, Object> cpu = Map.of("availableProcessors", Runtime.getRuntime().availableProcessors());
    apiService.sendHeartbeat(config.getAgentId(), currentTicketId, currentStep, mem, cpu);
  } catch (Exception e) {
    log.warn("Heartbeat failed", e);
  }
}, 0, 30, TimeUnit.SECONDS);
```

### Frontend Views

**AgentList.vue** — table with columns:
- Agent Name (link to detail)
- Status badge (green/yellow/red dot + text)
- Current Ticket (link)
- Actions Today (count)
- Cost Today (formatted currency)
- Last Seen (relative time)

**AgentDetail.vue** (or inline in AgentList, toggled) — shows:
- Agent info header (name, status, API preview)
- Stats: total actions, total cost
- Action history table (date, type, ticket, cost)
- Heartbeat history: last_seen, current_step

**Dashboard.vue** — add agent summary row/card:
```
Active Agents: 3 online | 2 idle | 1 offline
```
Fetch via `GET /api/v1/agents` and group by status.

### Error Handling

| Error Scenario | Handling |
|---------------|----------|
| Agent sends stale ticket ID | Heartbeat records it, cleanup job will detect staleness and release |
| Cleanup job fails (DB error) | Log error, retry on next interval |
| Two agents claim same ticket | Already prevented by ticket pickup logic |
| Agent heartbeat fails (network) | Agent logs warning, retries in 30s |
| Agent never sends heartbeat | Cleanup job marks offline after 60s |
| Frontend poll fails | Silent catch, agents list shows stale data until next poll |

### Alternatives Considered

- **WebSocket instead of polling** — Rejected because it adds complexity (connection management, reconnection logic). 10s polling is sufficient for a dashboard that doesn't need realtime.
- **Heartbeat as part of existing ticket updates** — Rejected because agents may be idle between tickets and we still need liveness.
- **30s vs 60s timeout** — 30s interval with 2-missed (60s) threshold chosen to balance responsiveness vs. false positives from small network hiccups.

## Security Considerations

- Heartbeat endpoint auth'd via `X-API-Key` — agent must have valid key
- Agent list/detail auth'd via JWT with `AGENT_READ` permission
- Agent can only heartbeat for its own ID (validated by looking up API key)
- No user data in heartbeat payload (memory/cpu stats are safe)
- Cleanup job runs server-side with full DB access — no user-facing trigger

## DB Changes

### New Migration: `021_agent_heartbeats.sql`

```sql
CREATE TABLE agent_heartbeats (
    agent_id VARCHAR(64) PRIMARY KEY,
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    current_ticket_id UUID REFERENCES tickets(id),
    current_step VARCHAR(64),
    memory_usage JSONB,
    cpu_usage JSONB,
    status VARCHAR(16) NOT NULL DEFAULT 'online'
);
```

### Rollback: `021_agent_heartbeats_rollback.sql`

```sql
DROP TABLE IF EXISTS agent_heartbeats;
```

## API Contract

### `POST /api/v1/agents/:id/heartbeat`

**Auth**: `X-API-Key` header

**Request body**:
```json
{
  "current_ticket_id": "uuid-optional",
  "current_step": "string-optional",
  "memory_usage": { "free": 123, "total": 456, "max": 789 },
  "cpu_usage": { "availableProcessors": 4 }
}
```

**Response 200**:
```json
{ "success": true }
```

### `GET /api/v1/agents`

**Auth**: JWT with `AGENT_READ`

**Response 200**:
```json
{
  "success": true,
  "data": [
    {
      "agentId": "uuid",
      "name": "agent-1",
      "status": "online",
      "currentTicketId": "uuid-or-null",
      "currentTicketTitle": "Fix login bug",
      "actionsToday": 12,
      "costToday": 0.60,
      "lastSeen": "2026-06-27T10:30:00Z"
    }
  ]
}
```

### `GET /api/v1/agents/:id`

**Auth**: JWT with `AGENT_READ`

**Response 200**:
```json
{
  "success": true,
  "data": {
    "agentId": "uuid",
    "name": "agent-1",
    "status": "online",
    "totalActions": 145,
    "totalCost": 7.25,
    "history": [
      { "id": "uuid", "actionType": "heartbeat", "createdAt": "...", "costIncurred": 0.05 }
    ]
  }
}
```
