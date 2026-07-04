# bp-33: Agent Heartbeat & Liveness — Implementation

**Status**: planned
**Priority**: P1
**Effort**: Medium
**Scope**: Backend + Frontend + Agent

## Purpose
Add agent heartbeat system so the system can detect dead agents, release their tickets, and display agent status in the UI.

## Implementation Order

1. **Create migration 021** — `backend/src/migrations/021_agent_heartbeats.sql`
   - CREATE TABLE agent_heartbeats (...)
   - *Depends on*: nothing

2. **Create migration rollback** — `backend/src/migrations/021_agent_heartbeats_rollback.sql`
   - DROP TABLE IF EXISTS agent_heartbeats
   - *Depends on*: nothing

3. **Modify `backend/src/migrations/apply.js`** — add 021 to SQL_FILES array
   - Append path to 021_agent_heartbeats.sql
   - *Depends on*: Step 1

4. **Create `backend/src/services/HeartbeatService.js`** — core heartbeat logic
   - recordHeartbeat(agentId, data) — UPSERT
   - getAgentStatus(agentId) — SELECT single row
   - getAllAgents() — JOIN with agent_actions for daily stats
   - cleanupStaleAgents() — mark offline + release tickets
   - *Depends on*: nothing (uses existing db.js pool)

5. **Create `backend/src/api/v1/agentHeartbeat.js`** — routes
   - POST /agents/:id/heartbeat — agent auth via X-API-Key
   - GET /agents — JWT auth, list all agent statuses
   - GET /agents/:id — JWT auth, agent detail
   - *Depends on*: Step 4 (HeartbeatService)

6. **Modify `backend/src/api/v1/index.js`** — mount agentHeartbeat routes
   - Add `router.use('/agents', agentHeartbeatRouter)`
   - *Depends on*: Step 5

7. **Modify `backend/src/index.js`** — start cleanup interval
   - Add `setInterval` calling HeartbeatService.cleanupStaleAgents every 30s
   - Store interval ID for cleanup on shutdown
   - *Depends on*: Step 4

8. **Modify `agent/.../ApiService.java`** — add sendHeartbeat method
   - POST to /agents/:id/heartbeat with current state
   - *Depends on*: nothing (follows existing executePost pattern)

9. **Modify `agent/.../AgentApp.java`** — add heartbeat scheduler
   - ScheduledExecutorService with 30s interval
   - Collect memory/cpu stats, call apiService.sendHeartbeat
   - *Depends on*: Step 8

10. **Create `frontend/src/api/agents.js`** — frontend API client
    - fetchAgents() → GET /api/v1/agents
    - fetchAgentDetail(id) → GET /api/v1/agents/:id
    - *Depends on*: nothing

11. **Create `frontend/src/views/AgentList.vue`** — agent list view
    - Table with status badges, poll every 10s via setInterval + onMounted
    - Row click navigates to agent detail
    - *Depends on*: Step 10

12. **Create `frontend/src/views/AgentDetail.vue`** — agent detail view
    - Shows agent info, action history table, cost summary
    - *Depends on*: Step 10

13. **Modify `frontend/src/router/index.ts`** — add /agents routes
    - /agents → AgentList.vue
    - /agents/:id → AgentDetail.vue
    - *Depends on*: Steps 11, 12

14. **Modify `frontend/src/views/Dashboard.vue`** — add agent summary
    - Fetch agents on mount, group by status, display summary row
    - Auto-refresh every 10s
    - *Depends on*: Step 10

## Per-File Action Plan

### `backend/src/migrations/021_agent_heartbeats.sql` (CREATE)
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

### `backend/src/migrations/021_agent_heartbeats_rollback.sql` (CREATE)
```sql
DROP TABLE IF EXISTS agent_heartbeats;
```

### `backend/src/services/HeartbeatService.js` (CREATE)
```javascript
const { pool } = require('../db');

class HeartbeatService {
  async recordHeartbeat(agentId, { ticketId, step, memory, cpu }) {
    const result = await pool.query(`
      INSERT INTO agent_heartbeats (agent_id, last_seen, current_ticket_id, current_step, memory_usage, cpu_usage, status)
      VALUES ($1, NOW(), $2, $3, $4::jsonb, $5::jsonb, 'online')
      ON CONFLICT (agent_id)
      DO UPDATE SET
        last_seen = NOW(),
        current_ticket_id = COALESCE($2, agent_heartbeats.current_ticket_id),
        current_step = COALESCE($3, agent_heartbeats.current_step),
        memory_usage = COALESCE($4::jsonb, agent_heartbeats.memory_usage),
        cpu_usage = COALESCE($5::jsonb, agent_heartbeats.cpu_usage),
        status = 'online'
      RETURNING *
    `, [agentId, ticketId || null, step || null, JSON.stringify(memory || {}), JSON.stringify(cpu || {})]);
    return result.rows[0];
  }

  async getAgentStatus(agentId) {
    const result = await pool.query(
      'SELECT ah.*, a.name as agent_name FROM agent_heartbeats ah LEFT JOIN agents a ON a.id::text = ah.agent_id WHERE ah.agent_id = $1',
      [agentId]
    );
    return result.rows[0] || null;
  }

  async getAllAgents() {
    const result = await pool.query(`
      SELECT
        ah.agent_id,
        a.name,
        ah.status,
        ah.current_ticket_id,
        ah.last_seen,
        ah.current_step,
        COALESCE(
          (SELECT COUNT(*) FROM agent_actions aa WHERE aa.agent_id::text = ah.agent_id AND aa.created_at >= CURRENT_DATE),
          0
        ) as actions_today,
        COALESCE(
          (SELECT SUM(aa.cost_incurred) FROM agent_actions aa WHERE aa.agent_id::text = ah.agent_id AND aa.created_at >= CURRENT_DATE),
          0
        ) as cost_today
      FROM agent_heartbeats ah
      LEFT JOIN agents a ON a.id::text = ah.agent_id
      ORDER BY ah.last_seen DESC NULLS LAST
    `);
    return result.rows;
  }

  async cleanupStaleAgents() {
    const staleResult = await pool.query(`
      UPDATE agent_heartbeats
      SET status = 'offline'
      WHERE last_seen < NOW() - INTERVAL '60 seconds'
        AND status = 'online'
      RETURNING agent_id, current_ticket_id
    `);
    const staleAgents = staleResult.rows;
    for (const agent of staleAgents) {
      if (agent.current_ticket_id) {
        try {
          const TicketService = require('./TicketService');
          await TicketService.release(agent.current_ticket_id);
        } catch (err) {
          console.error(`Failed to release ticket ${agent.current_ticket_id} for stale agent ${agent.agent_id}:`, err.message);
        }
      }
    }
    return staleAgents.length;
  }
}

module.exports = new HeartbeatService();
```

### `backend/src/api/v1/agentHeartbeat.js` (CREATE)
```javascript
const express = require('express');
const router = express.Router();
const HeartbeatService = require('../../services/HeartbeatService');
const AgentService = require('../../services/AgentService');
const { verifyToken } = require('../../middleware/auth');

// POST /api/v1/agents/:id/heartbeat — agent-side auth via X-API-Key
router.post('/:id/heartbeat', async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'X-API-Key header required' } });
    const agent = await AgentService.getAgentByApiKey(apiKey);
    if (!agent || agent.id !== req.params.id) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Invalid API key for this agent' } });
    const { current_ticket_id, current_step, memory_usage, cpu_usage } = req.body;
    await HeartbeatService.recordHeartbeat(req.params.id, { ticketId: current_ticket_id, step: current_step, memory: memory_usage, cpu: cpu_usage });
    res.json({ success: true });
  } catch (error) {
    console.error('POST /agents/:id/heartbeat', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

// GET /api/v1/agents — list all agents with status
router.get('/', verifyToken, async (req, res) => {
  try {
    const agents = await HeartbeatService.getAllAgents();
    res.json({ success: true, data: agents });
  } catch (error) {
    console.error('GET /agents', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

// GET /api/v1/agents/:id — agent detail
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const agent = await HeartbeatService.getAgentStatus(req.params.id);
    if (!agent) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Agent not found' } });
    const history = await AgentService.getAgentHistory(req.params.id, 100);
    const totalActions = history.length;
    const totalCost = history.reduce((sum, a) => sum + (a.cost_incurred || 0), 0);
    res.json({ success: true, data: { ...agent, history, totalActions, totalCost } });
  } catch (error) {
    console.error('GET /agents/:id', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

module.exports = router;
```

### `backend/src/api/v1/index.js` (MODIFY)
Add after existing routes:
```javascript
const agentHeartbeatRouter = require('./agentHeartbeat');
router.use('/agents', agentHeartbeatRouter);
```

### `backend/src/index.js` (MODIFY)
After pool is set up and server starts, add:
```javascript
const HeartbeatService = require('./services/HeartbeatService');
const HEARTBEAT_CLEANUP_MS = 30000;
const cleanupInterval = setInterval(async () => {
  try {
    const cleaned = await HeartbeatService.cleanupStaleAgents();
    if (cleaned > 0) console.log(`Heartbeat cleanup: ${cleaned} stale agent(s) marked offline`);
  } catch (err) {
    console.error('Heartbeat cleanup error:', err.message);
  }
}, HEARTBEAT_CLEANUP_MS);
// On graceful shutdown: clearInterval(cleanupInterval);
```

### `agent/.../ApiService.java` (MODIFY)
Add method:
```java
public void sendHeartbeat(String agentId, String currentTicketId, String currentStep,
    Map<String, Object> memoryUsage, Map<String, Object> cpuUsage) throws IOException {
  String url = baseUrl + "/agents/" + agentId + "/heartbeat";
  Map<String, Object> body = new HashMap<>();
  if (currentTicketId != null) body.put("current_ticket_id", currentTicketId);
  if (currentStep != null) body.put("current_step", currentStep);
  if (memoryUsage != null) body.put("memory_usage", memoryUsage);
  if (cpuUsage != null) body.put("cpu_usage", cpuUsage);
  executePost(url, body, new TypeReference<ApiResponse<Object>>() {});
}
```

### `agent/.../AgentApp.java` (MODIFY)
Add after config initialization:
```java
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.Map;
import java.util.HashMap;

// In constructor or start():
ScheduledExecutorService heartbeatScheduler = Executors.newScheduledThreadPool(1);
heartbeatScheduler.scheduleAtFixedRate(() -> {
  try {
    String currentTicketId = ticketProcessor.getCurrentTicketId();
    String currentStep = ticketProcessor.getCurrentStep();
    Map<String, Object> mem = new HashMap<>();
    mem.put("free", Runtime.getRuntime().freeMemory());
    mem.put("total", Runtime.getRuntime().totalMemory());
    mem.put("max", Runtime.getRuntime().maxMemory());
    Map<String, Object> cpu = new HashMap<>();
    cpu.put("availableProcessors", Runtime.getRuntime().availableProcessors());
    apiService.sendHeartbeat(config.getAgentId(), currentTicketId, currentStep, mem, cpu);
  } catch (Exception e) {
    log.warn("Failed to send heartbeat", e);
  }
}, 0, 30, TimeUnit.SECONDS);
```

Add shutdown hook to stop scheduler:
```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
  heartbeatScheduler.shutdown();
  log.info("Heartbeat scheduler stopped");
}));
```

### `frontend/src/api/agents.js` (CREATE)
```javascript
import { get } from './client'

export function fetchAgents() {
  return get('/api/v1/agents')
}

export function fetchAgentDetail(id) {
  return get(`/api/v1/agents/${id}`)
}
```

### `frontend/src/views/AgentList.vue` (CREATE)
```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { fetchAgents } from '@/api/agents'

const agents = ref<any[]>([])
const loading = ref(true)
const router = useRouter()
let pollInterval: ReturnType<typeof setInterval> | null = null

async function loadAgents() {
  try {
    agents.value = await fetchAgents()
  } catch (e) {
    console.error('Failed to load agents:', e)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadAgents()
  pollInterval = setInterval(loadAgents, 10000)
})

onUnmounted(() => {
  if (pollInterval) clearInterval(pollInterval)
})

function statusClass(status: string) {
  return { online: 'status-online', idle: 'status-idle', offline: 'status-offline' }[status] || 'status-offline'
}

function viewDetail(id: string) {
  router.push({ name: 'AgentDetail', params: { id } })
}
</script>

<template>
  <div class="agent-list">
    <h1>Agents</h1>
    <div v-if="loading" class="loading">Loading agents...</div>
    <table v-else class="agent-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Status</th>
          <th>Current Ticket</th>
          <th>Actions Today</th>
          <th>Cost Today</th>
          <th>Last Seen</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="agent in agents" :key="agent.agent_id" @click="viewDetail(agent.agent_id)" class="agent-row">
          <td>{{ agent.name || agent.agent_id }}</td>
          <td><span :class="['status-badge', statusClass(agent.status)]">{{ agent.status }}</span></td>
          <td>{{ agent.current_ticket_id ? agent.current_ticket_id.substring(0, 8) + '...' : '—' }}</td>
          <td>{{ agent.actions_today }}</td>
          <td>${{ Number(agent.cost_today || 0).toFixed(2) }}</td>
          <td>{{ agent.last_seen ? new Date(agent.last_seen).toLocaleString() : 'Never' }}</td>
        </tr>
      </tbody>
    </table>
    <div v-if="!loading && agents.length === 0" class="empty-state">No agents found.</div>
  </div>
</template>

<style scoped>
.agent-list { padding: 1.5rem; }
.agent-table { width: 100%; border-collapse: collapse; }
.agent-row { cursor: pointer; }
.agent-row:hover { background: #f5f5f5; }
.status-badge { padding: 2px 8px; border-radius: 12px; font-size: 0.85em; }
.status-online { background: #d4edda; color: #155724; }
.status-idle { background: #fff3cd; color: #856404; }
.status-offline { background: #f8d7da; color: #721c24; }
</style>
```

### `frontend/src/views/AgentDetail.vue` (CREATE)
```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { fetchAgentDetail } from '@/api/agents'

const route = useRoute()
const agent = ref<any>(null)
const loading = ref(true)

onMounted(async () => {
  try {
    agent.value = await fetchAgentDetail(route.params.id as string)
  } catch (e) {
    console.error('Failed to load agent detail:', e)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="agent-detail">
    <div v-if="loading">Loading...</div>
    <div v-else-if="agent" class="detail-content">
      <h1>{{ agent.name || agent.agent_id }}</h1>
      <div class="stats-row">
        <div class="stat"><label>Status</label><span :class="'status-' + agent.status">{{ agent.status }}</span></div>
        <div class="stat"><label>Total Actions</label><span>{{ agent.totalActions }}</span></div>
        <div class="stat"><label>Total Cost</label><span>${{ Number(agent.totalCost || 0).toFixed(2) }}</span></div>
        <div class="stat"><label>Current Step</label><span>{{ agent.current_step || '—' }}</span></div>
      </div>
      <h2>Action History</h2>
      <table class="history-table">
        <thead><tr><th>Date</th><th>Type</th><th>Cost</th></tr></thead>
        <tbody>
          <tr v-for="action in agent.history" :key="action.id">
            <td>{{ new Date(action.created_at).toLocaleString() }}</td>
            <td>{{ action.action_type }}</td>
            <td>${{ Number(action.cost_incurred || 0).toFixed(2) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.agent-detail { padding: 1.5rem; }
.stats-row { display: flex; gap: 2rem; margin: 1rem 0; }
.stat { display: flex; flex-direction: column; }
.stat label { font-size: 0.85em; color: #666; }
.history-table { width: 100%; border-collapse: collapse; }
.history-table th, .history-table td { padding: 0.5rem; text-align: left; border-bottom: 1px solid #eee; }
</style>
```

### `frontend/src/router/index.ts` (MODIFY)
Add to routes array, after Dashboard route:
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

### `frontend/src/views/Dashboard.vue` (MODIFY)
After projects section or in a summary row, add:
```vue
<script setup>
// Add import
import { fetchAgents } from '@/api/agents'
import { ref, onMounted, onUnmounted } from 'vue'
const agentSummary = ref({ online: 0, idle: 0, offline: 0 })
let agentPoll: ReturnType<typeof setInterval> | null = null

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

onMounted(() => {
  loadAgentSummary()
  agentPoll = setInterval(loadAgentSummary, 10000)
})

onUnmounted(() => {
  if (agentPoll) clearInterval(agentPoll)
})
</script>

<template>
  <!-- Add to template, e.g., in a summary card -->
  <div class="agent-summary" v-if="!loading">
    <span class="agent-count online">{{ agentSummary.online }} online</span>
    <span class="agent-count idle">{{ agentSummary.idle }} idle</span>
    <span class="agent-count offline">{{ agentSummary.offline }} offline</span>
    <router-link to="/agents" class="view-link">View Agents</router-link>
  </div>
</template>
```

## Migration Plan

1. Run `node backend/src/migrations/apply.js` to create the `agent_heartbeats` table
2. Existing agents will not have heartbeat rows until they first POST — this is expected (they show as "offline")

## Test Plan

### Unit Tests (Backend — Jest)
- [ ] `HeartbeatService.recordHeartbeat()` — creates new row for unknown agent_id
- [ ] `HeartbeatService.recordHeartbeat()` — updates existing row on second call
- [ ] `HeartbeatService.getAgentStatus()` — returns correct heartbeat row
- [ ] `HeartbeatService.getAllAgents()` — returns list with daily stats
- [ ] `HeartbeatService.cleanupStaleAgents()` — marks agents with old last_seen as offline
- [ ] `POST /agents/:id/heartbeat` — rejects request without X-API-Key
- [ ] `POST /agents/:id/heartbeat` — rejects request with wrong API key
- [ ] `GET /agents` — requires authentication

### Unit Tests (Frontend — Vitest)
- [ ] `agents.js` — `fetchAgents()` calls `GET /api/v1/agents`
- [ ] `agents.js` — `fetchAgentDetail(id)` calls correct URL
- [ ] `AgentList.vue` — renders loading state on mount
- [ ] `AgentList.vue` — renders agent rows from API data

### Manual Verification
- [ ] Run migration, verify table created
- [ ] Agent sends heartbeat → verify row in agent_heartbeats
- [ ] Agent stops → after 60s, agent shows offline, ticket released
- [ ] Frontend `/agents` shows agent list with correct statuses
- [ ] Dashboard shows agent summary counters
- [ ] Frontend polling updates agent list every 10s
- [ ] Agent detail shows action history

## Rollback Steps

1. Revert `backend/src/index.js` — remove cleanup interval
2. Revert `backend/src/api/v1/index.js` — remove agentHeartbeat mount
3. Delete `backend/src/api/v1/agentHeartbeat.js`
4. Delete `backend/src/services/HeartbeatService.js`
5. Run rollback migration: `021_agent_heartbeats_rollback.sql`
6. Revert `backend/src/migrations/apply.js`
7. Revert agent Java files
8. Delete frontend files: `AgentList.vue`, `AgentDetail.vue`, `api/agents.js`
9. Revert `router/index.ts` and `Dashboard.vue`
