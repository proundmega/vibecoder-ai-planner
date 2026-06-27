# bp-33: Agent Heartbeat & Liveness — Spec

**Target model**: 14B–70B (Node.js + Java + Vue/TypeScript)
**Date**: 2026-06-27

## File Operations

### CREATE: `backend/src/migrations/021_agent_heartbeats.sql`

**SQL**:
```sql
CREATE TABLE IF NOT EXISTS agent_heartbeats (
    agent_id VARCHAR(64) PRIMARY KEY,
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    current_ticket_id UUID REFERENCES tickets(id),
    current_step VARCHAR(64),
    memory_usage JSONB DEFAULT '{}',
    cpu_usage JSONB DEFAULT '{}',
    status VARCHAR(16) NOT NULL DEFAULT 'online'
);
```

### CREATE: `backend/src/migrations/021_agent_heartbeats_rollback.sql`

**SQL**:
```sql
DROP TABLE IF EXISTS agent_heartbeats;
```

### MODIFY: `backend/src/migrations/apply.js`

**Change location**: Append to `SQL_FILES` array, after `017_agent_memory_fallback.sql`:
```javascript
path.join(__dirname, './021_agent_heartbeats.sql'),
```

### CREATE: `backend/src/services/HeartbeatService.js`

**Imports**:
```javascript
const { pool } = require('../db');
```

**Exports**: `module.exports = new HeartbeatService()`

**Method signatures**:
```javascript
async recordHeartbeat(agentId, { ticketId, step, memory, cpu })
  → UPSERT INTO agent_heartbeats, returns row

async getAgentStatus(agentId)
  → SELECT from agent_heartbeats LEFT JOIN agents, returns single row

async getAllAgents()
  → SELECT with daily action/cost aggregates, returns array

async cleanupStaleAgents()
  → UPDATE status='offline' WHERE last_seen < NOW()-60s AND status='online'
  → For each stale agent with current_ticket_id, call TicketService.release(id)
  → Returns count of stale agents
```

**Implementation notes**:
- `cleanupStaleAgents` uses `require()` inside the method, not at module top level, to avoid circular dependency with TicketService
- `recordHeartbeat` uses `ON CONFLICT DO UPDATE` — PostgreSQL upsert pattern
- All methods are async and use `pool.query()`

### CREATE: `backend/src/api/v1/agentHeartbeat.js`

**Imports**:
```javascript
const express = require('express');
const router = express.Router();
const HeartbeatService = require('../../services/HeartbeatService');
const AgentService = require('../../services/AgentService');
const { verifyToken } = require('../../middleware/auth');
```

**Routes**:

```javascript
// POST /api/v1/agents/:id/heartbeat
// Auth: X-API-Key header → validated via AgentService.getAgentByApiKey
// Body: { current_ticket_id?, current_step?, memory_usage?, cpu_usage? }
// Response: { success: true }

// GET /api/v1/agents
// Auth: JWT (verifyToken)
// Response: { success: true, data: [{ agent_id, name, status, current_ticket_id, last_seen, current_step, actions_today, cost_today }] }

// GET /api/v1/agents/:id
// Auth: JWT (verifyToken)
// Response: { success: true, data: { agent_id, name, status, current_ticket_id, history: [...], totalActions, totalCost } }
```

### MODIFY: `backend/src/api/v1/index.js`

**Change location**: After existing route mounts, add:
```javascript
const agentHeartbeatRouter = require('./agentHeartbeat');
router.use('/agents', agentHeartbeatRouter);
```

### MODIFY: `backend/src/index.js`

**Change location**: After database pool is connected and before server.listen.

**Add**:
```javascript
const HeartbeatService = require('./services/HeartbeatService');
const HEARTBEAT_CLEANUP_MS = 30000;
const cleanupInterval = setInterval(async () => {
  try {
    const count = await HeartbeatService.cleanupStaleAgents();
    if (count > 0) {
      console.log(`[heartbeat] Cleaned up ${count} stale agent(s)`);
    }
  } catch (err) {
    console.error('[heartbeat] Cleanup error:', err.message);
  }
}, HEARTBEAT_CLEANUP_MS);

// In graceful shutdown handler:
// clearInterval(cleanupInterval);
```

### MODIFY: `agent/src/.../service/ApiService.java`

**Imports to add**: No new imports needed (uses existing OkHttp, ObjectMapper, TypeReference, Map).

**Add method** (after existing `getDecryptedKey()`):
```java
public void sendHeartbeat(String agentId, String currentTicketId, String currentStep,
    Map<String, Object> memoryUsage, Map<String, Object> cpuUsage) throws IOException {
  String url = baseUrl + "/agents/" + agentId + "/heartbeat";
  Map<String, Object> body = new java.util.HashMap<>();
  if (currentTicketId != null) body.put("current_ticket_id", currentTicketId);
  if (currentStep != null) body.put("current_step", currentStep);
  if (memoryUsage != null) body.put("memory_usage", memoryUsage);
  if (cpuUsage != null) body.put("cpu_usage", cpuUsage);
  executePost(url, body, new com.fasterxml.jackson.core.type.TypeReference<ApiResponse<Object>>() {});
}
```

### MODIFY: `agent/src/.../AgentApp.java`

**Imports to add**:
```java
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.Map;
import java.util.HashMap;
```

**Add field**:
```java
private ScheduledExecutorService heartbeatScheduler;
```

**In `start()` method**, after `config` initialization:
```java
heartbeatScheduler = Executors.newScheduledThreadPool(1);
heartbeatScheduler.scheduleAtFixedRate(() -> {
  try {
    Map<String, Object> mem = new HashMap<>();
    mem.put("free", Runtime.getRuntime().freeMemory());
    mem.put("total", Runtime.getRuntime().totalMemory());
    mem.put("max", Runtime.getRuntime().maxMemory());

    Map<String, Object> cpu = new HashMap<>();
    cpu.put("availableProcessors", Runtime.getRuntime().availableProcessors());

    apiService.sendHeartbeat(
      config.getAgentId(),
      ticketProcessor.getCurrentTicketId(),
      ticketProcessor.getCurrentStep(),
      mem,
      cpu
    );
  } catch (Exception e) {
    log.warn("Heartbeat send failed", e);
  }
}, 0, 30, TimeUnit.SECONDS);
```

**In `shutdown()` method**, add:
```java
if (heartbeatScheduler != null) {
  heartbeatScheduler.shutdown();
  try {
    heartbeatScheduler.awaitTermination(5, TimeUnit.SECONDS);
  } catch (InterruptedException e) {
    Thread.currentThread().interrupt();
  }
}
```

### CREATE: `frontend/src/api/agents.js`

**Imports**:
```javascript
import { get } from './client'
```

**Exports**:
```javascript
export function fetchAgents()
  → get('/api/v1/agents')

export function fetchAgentDetail(id)
  → get(`/api/v1/agents/${id}`)
```

### CREATE: `frontend/src/views/AgentList.vue`

**Script setup**:
- Imports: `ref, onMounted, onUnmounted` from `vue`, `useRouter` from `vue-router`, `fetchAgents` from `@/api/agents`
- State: `agents` (ref array), `loading` (ref boolean)
- `loadAgents()` — async, sets `agents = await fetchAgents()`
- `onMounted` — calls `loadAgents()`, starts `setInterval(loadAgents, 10000)`
- `onUnmounted` — clears interval

**Template**:
- Loading state: `div.loading`
- Empty state: `div.empty-state` when `agents.length === 0`
- Table: 6 columns (Name, Status, Current Ticket, Actions Today, Cost Today, Last Seen)
- Status badge with CSS classes `.status-online` (green), `.status-idle` (yellow), `.status-offline` (red)
- Row click → `router.push({ name: 'AgentDetail', params: { id } })`

**CSS**: Scoped, minimal.

### CREATE: `frontend/src/views/AgentDetail.vue`

**Script setup**:
- Imports: `ref, onMounted` from `vue`, `useRoute` from `vue-router`, `fetchAgentDetail` from `@/api/agents`
- State: `agent` (ref), `loading` (ref boolean)
- `onMounted` — calls `fetchAgentDetail(route.params.id)`

**Template**:
- Header: agent name
- Stats row: status, total actions, total cost, current step
- Action history table: Date, Type, Cost
- Back link to `/agents`

### MODIFY: `frontend/src/router/index.ts`

**Add routes** (after Dashboard, before approvals):
```typescript
{
  path: '/agents',
  name: 'AgentList',
  component: () => import('../views/AgentList.vue'),
  meta: { requiresAuth: true, requiredPermission: 'AGENT_READ' },
},
{
  path: '/agents/:id',
  name: 'AgentDetail',
  component: () => import('../views/AgentDetail.vue'),
  meta: { requiresAuth: true },
},
```

### MODIFY: `frontend/src/views/Dashboard.vue`

**Imports to add** in `<script setup>`:
```javascript
import { fetchAgents } from '@/api/agents'
```

**State to add**:
```javascript
const agentSummary = ref({ online: 0, idle: 0, offline: 0 })
let agentPollInterval: ReturnType<typeof setInterval> | null = null
```

**Inline function**:
```javascript
async function loadAgentSummary() {
  try {
    const agents = await fetchAgents()
    agentSummary.value = {
      online: agents.filter((a: any) => a.status === 'online').length,
      idle: agents.filter((a: any) => a.status === 'idle').length,
      offline: agents.filter((a: any) => a.status === 'offline').length,
    }
  } catch {}
}
```

**Lifecycle hooks**: Call `loadAgentSummary()` in `onMounted`. Start `setInterval(loadAgentSummary, 10000)` in `onMounted`, clear in `onUnmounted`.

**Template addition** (insert in summary section):
```html
<div class="agent-summary" v-if="!loading">
  <router-link to="/agents" class="summary-link">
    <span class="count-online">{{ agentSummary.online }} online</span>
    <span class="count-idle">{{ agentSummary.idle }} idle</span>
    <span class="count-offline">{{ agentSummary.offline }} offline</span>
  </router-link>
</div>
```

**CSS (scoped)**:
```css
.agent-summary { display: flex; gap: 1rem; padding: 0.5rem 0; }
.count-online { color: #155724; }
.count-idle { color: #856404; }
.count-offline { color: #721c24; }
```

## Test Expectations

### Backend Unit Tests (Jest)
- [ ] `HeartbeatService.recordHeartbeat()` — inserts new row for `agent_id` that doesn't exist
- [ ] `HeartbeatService.recordHeartbeat()` — updates `last_seen` and `status` for existing `agent_id`
- [ ] `HeartbeatService.getAgentStatus()` — returns row with correct fields
- [ ] `HeartbeatService.getAgentStatus()` — returns null for unknown agent
- [ ] `HeartbeatService.getAllAgents()` — returns array, each with `agent_id`, `status`, `actions_today`
- [ ] `HeartbeatService.cleanupStaleAgents()` — marks agents with `last_seen > 60 seconds ago` as offline
- [ ] `POST /agents/:id/heartbeat` — returns 401 without API key
- [ ] `POST /agents/:id/heartbeat` — returns 403 with wrong API key
- [ ] `POST /agents/:id/heartbeat` — returns 200 with valid API key
- [ ] `GET /agents` — returns array of agent statuses
- [ ] `GET /agents/:id` — returns agent detail with history

### Frontend Unit Tests (Vitest)
- [ ] `api/agents.fetchAgents()` — calls `GET /api/v1/agents`
- [ ] `api/agents.fetchAgentDetail('abc')` — calls `GET /api/v1/agents/abc`
- [ ] `AgentList.vue` — renders loading state initially
- [ ] `AgentList.vue` — renders agent rows after data load
- [ ] `AgentList.vue` — polling interval is set and cleared

### Manual Verification
- [ ] Migration runs without errors
- [ ] Agent sends heartbeat → row appears in DB
- [ ] Agent stops → after 60s, row shows `status='offline'` and `current_ticket_id` is cleared
- [ ] Frontend `/agents` loads and updates every 10s
- [ ] Dashboard shows agent summary counts that update every 10s
- [ ] Agent detail page shows history and cost

## Edge Cases to Handle

1. **Agent sends heartbeat before agent record exists in `agents` table** — HeartbeatService doesn't join on agents table for writes; it always upserts. The `GET /agents` endpoint left-joins so missing agents records show null name.
2. **Concurrent cleanup + heartbeat** — Cleanup marks agent offline, then agent sends heartbeat → heartbeat sets status back to `online`. This is correct behavior.
3. **Ticket already released by other means** — When cleanup tries to release a stale agent's ticket, `TicketService.release()` may throw if ticket is already released. Catch and log, don't fail the cleanup batch.
4. **Agent ID format mismatch** — Backend uses UUID strings, agent sends its DB record's UUID. The agent gets its UUID from the backend response at registration time.
5. **Large number of agents** — Cleanup query scans all `online` heartbeats with `last_seen < NOW()-60s`. Even with 1000 agents this is a trivial indexed query.
6. **Frontend poll fails (network)** — Silent catch, agents list retains last successful data until next poll.
7. **Two frontend tabs open** — Each tab polls independently. Both show consistent data from the same API. No state conflict.
8. **Agent clock skew** — Agent runs server time (Docker container). If clock skew occurs, `last_seen` is set by backend on receive, not agent's timestamp.

## Existing Code Patterns to Follow

- Backend services: export as singleton `new ServiceName()`, use `require('../db').pool`
- Backend routes: `express.Router()`, export `module.exports = router`, use async handlers with try/catch
- Backend auth: `verifyToken` for JWT, `X-API-Key` header lookup via `AgentService.getAgentByApiKey`
- API responses: `{ success: true, data: ... }` or `{ success: false, error: { code, message } }`
- Frontend API: import `{ get }` from `'./client'`, return promise
- Frontend views: `<script setup lang="ts">`, scoped CSS, `@/` alias
- Frontend polling: `onMounted` start interval, `onUnmounted` clear
- Agent Java: OkHttp + Jackson, SLF4J logging, `executePost` helper method

## Files NOT to Change

- `backend/src/services/TicketService.js` — only the `release()` method may be referenced but not modified
- `backend/src/middleware/*` — no middleware changes
- `frontend/src/api/client.js` — no changes to base HTTP client
- `frontend/src/stores/*` — no store changes
- `frontend/App.vue` — no layout changes
- `agent/src/.../model/*` — no model changes
- `agent/src/.../config/AgentConfig.java` — may add `agentId` getter if missing
- `docker-compose.yml` — no changes
