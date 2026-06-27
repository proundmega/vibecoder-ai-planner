# bp-30: System Diagnostics — Spec

**Target model**: 14B (JavaScript)
**Date**: 2026-06-27

## File Operations

### CREATE: `backend/src/services/DiagnosticsService.js`

**Imports**:
```javascript
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const db = require('../db');
const logger = require('../utils/logger');
```

**Internal Map**:
```javascript
const runs = new Map();
const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
```

**Step definitions** (inside the service):
```javascript
const STEPS = {
    fast: [
        { name: 'Backend API', handler: checkBackendApi },
        { name: 'Database', handler: checkDatabase },
        { name: 'Auth Flow', handler: checkAuthFlow },
        { name: 'Frontend', handler: checkFrontend },
        { name: 'Planning System', handler: checkPlanning },
        { name: 'Credential Store', handler: checkCredentials },
    ],
    slow: [
        { name: 'AI Provider', handler: checkAiProvider },
        { name: 'Agent Liveness', handler: checkAgentLiveness },
        { name: 'GitHub Connection', handler: checkGitHub },
    ],
};
```

**Handler signatures** (each returns `{ passed: boolean, detail: string }`):
```javascript
async function checkBackendApi()
  → GET ${BASE_URL}/api/health
  → passed if response.data.success === true && response.data.data.status === 'ok'
  → detail: "HTTP ${status}, status: ${data.data.status}"

async function checkDatabase()
  → POST ${BASE_URL}/api/v1/projects (create test project) → then DELETE it
  → passed if both succeed
  → detail: "Project created and deleted"

async function checkAuthFlow()
  → POST ${BASE_URL}/api/auth/register (test user) → POST /api/auth/login → GET /api/auth/me
  → passed if all three succeed
  → detail: "Register → Login → Token verified"

async function checkFrontend()
  → GET ${FRONTEND_URL}/
  → passed if HTTP 200
  → detail: "HTTP ${status}"

async function checkPlanning()
  → First run checkBackendApi + checkDatabase (need projects + auth)
  → GET projects → pick one → GET templates → verify list is array
  → passed if templates are returned
  → detail: "${count} templates available"

async function checkCredentials()
  → POST ${BASE_URL}/api/v1/credentials (create test cred) → GET /decrypt → DELETE
  → passed if round-trip matches
  → detail: "Encrypt → Decrypt round-trip OK"

async function checkAiProvider()
  → Get provider config from DB (first project with config)
  → POST to provider endpoint with trivial prompt
  → passed if returns content within 30s

async function checkAgentLiveness()
  → GET ${BASE_URL}/api/v1/agents
  → passed if at least one agent with last_seen < 2 minutes ago

async function checkGitHub()
  → GET ${BASE_URL}/api/v1/github (first project with config)
  → passed if repo responds
```

**Main methods**:
```javascript
async function run(mode = 'fast')
  1. const runId = uuidv4()
  2. const allSteps = [...STEPS.fast, ...(mode === 'extended' ? STEPS.slow : [])]
  3. const steps = allSteps.map(s => ({ name: s.name, status: 'pending', duration_ms: null, detail: null }))
  4. runs.set(runId, { status: 'running', steps, createdAt: Date.now() })
  5. // Run fast in parallel, slow sequentially
  6. const runSteps = async () => { ... update steps in runs map ... }
  7. runSteps()  // don't await — let it run in background
  8. return runId

function getStatus(runId)
  return runs.get(runId) || null
```

**Exports**: `module.exports = { run, getStatus }`

### CREATE: `backend/src/api/diagnostics.js`

**Imports**:
```javascript
const express = require('express');
const router = express.Router();
const diagnosticsService = require('../../services/DiagnosticsService');
```

**Routes**:
```javascript
router.post('/run', async (req, res) => {
    const mode = req.body.mode || 'fast';
    const runId = await diagnosticsService.run(mode);
    res.status(202).json({ success: true, data: { run_id: runId, status: 'running' } });
});

router.get('/status/:runId', async (req, res) => {
    const status = diagnosticsService.getStatus(req.params.runId);
    if (!status) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Run not found' } });
    res.json({ success: true, data: { run_id: req.params.runId, ...status } });
});

module.exports = router;
```

### MODIFY: `backend/src/api/routes.js`

**Add at top** (after other route requires):
```javascript
const diagnosticsRouter = require('./diagnostics');
```

**Add before catch-all**:
```javascript
router.use('/diagnostics', diagnosticsRouter);
```

### CREATE: `frontend/src/api/diagnostics.js`

```javascript
import { get, post } from './client';

export function startDiagnostics(mode = 'fast') {
    return post('/api/diagnostics/run', { mode });
}

export function getDiagnosticsStatus(runId) {
    return get(`/api/diagnostics/status/${runId}`);
}
```

### CREATE: `frontend/src/views/SystemDiagnostics.vue`

**Script setup**:
```javascript
import { ref, onMounted } from 'vue';
import { startDiagnostics, getDiagnosticsStatus } from '@/api/diagnostics';

const results = ref(JSON.parse(localStorage.getItem('vibecode_last_diag') || 'null'));
const running = ref(false);
const runId = ref(null);

async function runTests(mode = 'fast') {
    running.value = true;
    const resp = await startDiagnostics(mode);
    runId.value = resp.run_id;
    pollStatus();
}

async function pollStatus() {
    const poll = setInterval(async () => {
        const status = await getDiagnosticsStatus(runId.value);
        if (!status) return;
        results.value = status;
        if (status.status === 'completed') {
            clearInterval(poll);
            running.value = false;
            localStorage.setItem('vibecode_last_diag', JSON.stringify(status));
        }
    }, 1000);
}

const passedCount = computed(() =>
    results.value?.steps?.filter(s => s.status === 'passed').length || 0);
const failedCount = computed(() =>
    results.value?.steps?.filter(s => s.status === 'failed' || s.status === 'error').length || 0);

onMounted(() => {
    // Load last result from localStorage
});
```

**Template**:
```html
<div class="diagnostics-page">
  <h1>🔬 System Diagnostics</h1>
  <div class="diag-controls">
    <button @click="runTests('fast')" :disabled="running" class="btn-primary">
      {{ running ? 'Running...' : 'Run Tests' }}
    </button>
    <select v-model="selectedMode" :disabled="running">
      <option value="fast">Fast Checks</option>
      <option value="extended">Extended (includes AI + Agents + GitHub)</option>
    </select>
  </div>

  <div v-if="results" class="diag-summary">
    Last run: {{ timeAgo(results.createdAt) }} |
    Duration: {{ results.steps.reduce((a,s) => a + (s.duration_ms||0), 0) }}ms |
    {{ passedCount }}/{{ results.steps.length }} passed
  </div>

  <div v-if="results" class="diag-table">
    <div v-for="step in results.steps" :key="step.name" class="diag-row" :class="step.status">
      <span class="diag-icon">{{ statusIcon(step.status) }}</span>
      <span class="diag-name">{{ step.name }}</span>
      <span class="diag-duration">{{ step.duration_ms ? step.duration_ms + 'ms' : '—' }}</span>
      <span class="diag-detail">{{ step.detail || statusLabel(step.status) }}</span>
      <div v-if="step.status === 'failed' || step.status === 'error'" class="diag-error">
        {{ step.detail }}
      </div>
    </div>
  </div>
</div>
```

**Helper functions** (in script):
```javascript
function statusIcon(status) {
    return { running: '⏳', passed: '✅', failed: '❌', error: '⚠️', pending: '⚪' }[status] || '⚪';
}
function statusLabel(status) {
    return { running: 'Running...', passed: 'Passed', failed: 'Failed', error: 'Error', pending: 'Pending' }[status] || '';
}
function timeAgo(ts) {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    return mins < 1 ? 'just now' : mins + 'm ago';
}
```

### MODIFY: `frontend/src/router/index.ts`

**Add import** (top):
```javascript
import SystemDiagnostics from '../views/SystemDiagnostics.vue';
```

**Add route** (after `/users`):
```javascript
{
    path: '/diagnostics',
    name: 'SystemDiagnostics',
    component: SystemDiagnostics,
    meta: { requiresAuth: true },
},
```

### MODIFY: `frontend/src/views/Dashboard.vue`

**Add section** after project list:
```javascript
const lastDiag = ref(JSON.parse(localStorage.getItem('vibecode_last_diag') || 'null'));
const diagSummary = computed(() => {
    if (!lastDiag.value) return null;
    const s = lastDiag.value.steps;
    return { passed: s.filter(x => x.status === 'passed').length, total: s.length };
});
```

```html
<div v-if="diagSummary" class="dashboard-section health-card">
  <h2>🩺 System Health</h2>
  <p>Last test: {{ diagSummary.passed }}/{{ diagSummary.total }} passed</p>
  <router-link to="/diagnostics" class="btn-secondary">View Details →</router-link>
</div>
```

## Test Expectations

```
✓ POST /api/diagnostics/run returns 202 with run_id
✓ GET /api/diagnostics/status/:runId returns steps with statuses
✓ All 6 fast checks complete within 5 seconds
✓ Frontend table shows correct icons per status
✓ Results persist in localStorage across refresh
✓ Dashboard shows health summary after first run
```

## Edge Cases to Handle

1. **Frontend not running**: checkFrontend fails gracefully, doesn't crash other checks
2. **No projects exist**: checkPlanning falls back gracefully ("No projects to test")
3. **Concurrent runs**: each run creates a new runId; results don't collide
4. **Old results expire**: runs Map doesn't grow unbounded (optional: limit to 10 entries)
