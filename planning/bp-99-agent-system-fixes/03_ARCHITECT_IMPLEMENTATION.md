# 03_ARCHITECT_IMPLEMENTATION.md — Agent System Fixes & Feature Completion

**Ticket**: bp-99-agent-system-fixes
**Status**: planned
**Priority**: P1
**Effort**: Large
**Author**: AI Assistant
**Date created**: 2026-07-15
**Date completed**: {{YYYY-MM-DD}}
**Branch**: fix/bp-99-agent-system-fixes
**Scope**: Backend | Java Agent | Frontend

---

### a) Purpose

Comprehensive fix of 12 agent system issues: critical blockers (env var mismatch, ID type mismatch), missing features (provider config fetch, agent rename), and code quality improvements (message ordering, deprecated methods, health check, cleanup scheduler).

---

### b) Actions

#### Implementation Order

1. **PoolManager fixes** — `backend/src/services/PoolManager.js`
   - Fix env var name: `API_KEY` -> `AGENT_API_KEY`
   - Create DB agent record when requesting pool agent
   - Delete DB record when releasing pool agent
   - *Depends on*: nothing

2. **HeartbeatService cleanup** — `backend/src/services/HeartbeatService.js`
   - Export cleanup method for use in index.js
   - *Depends on*: nothing

3. **Start cleanup scheduler** — `backend/src/index.js`
   - Import HeartbeatService
   - Add setInterval to call cleanupStaleAgents() every 5min
   - *Depends on*: Step 2

4. **Backend agent endpoints** — `backend/src/api/agents.js`
   - Add `PUT /:agentId` route (bp-77)
   - Add `GET /:agentId/provider-config` route (bp-02)
   - *Depends on*: Step 5 (service methods)

5. **AgentService methods** — `backend/src/services/AgentService.js`
   - Add `updateName(agentId, name, userId)`
   - Add `getProviderConfig(agentId, apiKey)`
   - Remove `getApiKey()` (deprecated)
   - Fix `revokeApiKey()` to set api_key_hash = NULL
   - *Depends on*: Step 6 (validators)

6. **Validators** — `backend/src/validators/agents.js`
   - Add `updateAgentSchema` Joi schema
   - *Depends on*: nothing

7. **Java AgentConfig** — `agent/.../config/AgentConfig.java`
   - Make AGENT_ID required via requireEnv()
   - *Depends on*: nothing

8. **Java ApiService** — `agent/.../service/ApiService.java`
   - Add `getProviderConfig(String agentId)` method
   - *Depends on*: nothing

9. **Java AgentApp** — `agent/.../AgentApp.java`
   - Fetch provider config from backend at startup
   - Use fetched config for AI provider initialization
   - Fall back to env vars if fetch fails
   - *Depends on*: Step 8

10. **Java TicketProcessor** — `agent/.../service/TicketProcessor.java`
    - Move "Started working" message before processing
    - Reuse apiService's httpClient for planning docs
    - *Depends on*: nothing

11. **Java GitHubService** — `agent/.../service/GitHubService.java`
    - Fix createCommit to get parent SHA
    - *Depends on*: nothing

12. **Java Dockerfile** — `agent/Dockerfile`
    - Replace HTTP health check with process-alive check
    - *Depends on*: nothing

13. **Frontend router** — `frontend/src/router/index.ts`
    - Remove `/agents/:id/terminal` route
    - *Depends on*: nothing

14. **Frontend API client** — `frontend/src/api/agents.ts`
    - Add `updateAgentName(agentId, name)` function
    - Add `getAgentProviderConfig(agentId)` function
    - *Depends on*: nothing

15. **Frontend AgentList** — `frontend/src/views/AgentList.vue`
    - Add inline name editing in agents tab
    - *Depends on*: Step 14

16. **Backend tests** — `backend/src/__tests__/agentEdit.test.js`
    - Test PUT /api/agents/:agentId
    - Test GET /api/v1/agents/:agentId/provider-config
    - *Depends on*: Steps 4-5

17. **Frontend tests** — `frontend/src/__tests__/agentEdit.test.ts`
    - Test inline edit mode
    - *Depends on*: Step 15

---

### c) Per-File Action Plan

#### `backend/src/services/PoolManager.js` (MODIFY)
- **Line 59**: Change `API_KEY=${apiKey}` to `AGENT_API_KEY=${apiKey}`
- **requestAgent method**: After generating apiKey, create a DB agent record via AgentService.create()
- **releaseAgent method**: Delete the DB agent record after stopping container
- **Imports needed**: `const AgentService = require('./AgentService')`

#### `backend/src/services/HeartbeatService.js` (MODIFY)
- No changes needed — cleanupStaleAgents() already exists and is exported

#### `backend/src/index.js` (MODIFY)
- **Add after app setup**: Start heartbeat cleanup scheduler
```js
const HeartbeatService = require('./services/HeartbeatService');
setInterval(() => {
  HeartbeatService.cleanupStaleAgents().catch(err => {
    logger.error('Heartbeat cleanup failed:', err.message);
  });
}, 300000); // 5 minutes
```

#### `backend/src/api/agents.js` (MODIFY)
- **Add PUT route** before DELETE route:
```js
router.put('/:agentId', verifyTokenOrAgent, requireAnyPermission('AGENT_REVOKE'), validate(updateAgentSchema), async (req, res) => {
  const { name } = req.body;
  const result = await AgentService.updateName(req.params.agentId, name, req.user.userId);
  res.json({ ...result });
});
```
- **Add GET provider-config route** after history route:
```js
router.get('/:agentId/provider-config', async (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'X-API-Key required' });
  try {
    const config = await AgentService.getProviderConfig(req.params.agentId, apiKey);
    res.json(config);
  } catch (error) { next(error); }
});
```

#### `backend/src/services/AgentService.js` (MODIFY)
- **Add updateName method**:
```js
async updateName(agentId, name, userId) {
  const result = await pool.query(
    'UPDATE agents SET name = $1 WHERE id = $2 AND owner_id = $3 RETURNING id, name, updated_at',
    [name, agentId, userId]
  );
  if (result.rows.length === 0) throw new Error('AGENT_NOT_FOUND');
  return result.rows[0];
}
```
- **Add getProviderConfig method**:
```js
async getProviderConfig(agentId, apiKey) {
  const agent = await this.getAgentByApiKey(apiKey);
  if (!agent) throw new Error('AGENT_NOT_FOUND');
  if (!agent.provider_id) throw new Error('NO_PROVIDER');
  const enc = require('../utils/encryption');
  const result = await pool.query(
    `SELECT p.provider_type, p.api_key_encrypted, p.base_url, p.model, p.max_tokens
     FROM providers p WHERE p.id = $1`, [agent.provider_id]
  );
  if (result.rows.length === 0) throw new Error('PROVIDER_NOT_FOUND');
  const provider = result.rows[0];
  const decryptedKey = provider.api_key_encrypted ? enc.decrypt(provider.api_key_encrypted) : null;
  return { success: true, data: {
    provider_type: provider.provider_type,
    api_key: decryptedKey,
    base_url: provider.base_url,
    model: provider.model,
    max_tokens: provider.max_tokens,
  }};
}
```
- **Remove getApiKey()** method
- **Fix revokeApiKey()**: Change to `UPDATE agents SET api_key_hash = NULL, api_key_hash_prefix = NULL WHERE id = $1`

#### `backend/src/validators/agents.js` (MODIFY)
- **Add updateAgentSchema**:
```js
const updateAgentSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
});
```
- Export it

#### `agent/Dockerfile` (MODIFY)
- **Line 22-23**: Replace HTTP health check:
```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD pgrep -f "java -jar agent.jar" || exit 1
```

#### `agent/src/main/java/.../config/AgentConfig.java` (MODIFY)
- **Line 48**: Change `getEnv("AGENT_ID", null)` to `requireEnv("AGENT_ID")`

#### `agent/src/main/java/.../service/ApiService.java` (MODIFY)
- **Add getProviderConfig method**:
```java
public Map<String, Object> getProviderConfig(String agentId) throws IOException {
    String url = baseUrl + "/agents/" + agentId + "/provider-config";
    ApiResponse<Map<String, Object>> response = executeGet(url, new TypeReference<ApiResponse<Map<String, Object>>>() {});
    if (response.hasError()) throw new IOException("Failed to get provider config: " + response.getError());
    return response.getData();
}
```

#### `agent/src/main/java/.../AgentApp.java` (MODIFY)
- **In createAiProvider()**: Before creating provider, fetch config from backend:
```java
private AiProvider createAiProvider() {
    // Try fetching provider config from backend first
    Map<String, Object> providerConfig = null;
    try {
        providerConfig = apiService.getProviderConfig(config.getAgentId());
        log.info("Fetched provider config from backend: {}", providerConfig.get("provider_type"));
    } catch (Exception e) {
        log.warn("Failed to fetch provider config from backend, using env vars: {}", e.getMessage());
    }
    
    if (providerConfig != null) {
        // Use fetched config
        String apiKey = (String) providerConfig.get("api_key");
        String baseUrl = (String) providerConfig.get("base_url");
        String model = (String) providerConfig.get("model");
        String providerType = (String) providerConfig.get("provider_type");
        // ... create provider with fetched config
    }
    // Fall back to env vars if no config from backend
    // ... existing env var logic
}
```

#### `agent/src/main/java/.../service/TicketProcessor.java` (MODIFY)
- **Move postMessage**: Move "Started working" message from line 137 to after line 79 (after pickUpTicket)
- **Reuse httpClient**: Pass apiService.httpClient to fetchPlanningDocs or make httpClient accessible

#### `agent/src/main/java/.../service/GitHubService.java` (MODIFY)
- **Fix createCommit**: Get parent SHA before creating commit:
```java
public String createCommit(String branchName, String message, String filePath, String content) throws IOException {
    String parentSha = getBranchSha(branchName); // Get latest commit
    // ... create tree
    commitBody.put("parent", parentSha);
    // ... create commit
}
```

#### `frontend/src/router/index.ts` (MODIFY)
- **Remove lines 150-165**: Delete the `/agents/:id/terminal` route

#### `frontend/src/api/agents.ts` (MODIFY)
- **Add updateAgentName**:
```ts
export function updateAgentName(agentId: string, name: string): Promise<{ id: number; name: string }> {
  return put(`/api/v1/agents/${agentId}`, { name })
}
```
- **Add getAgentProviderConfig**:
```ts
export function getAgentProviderConfig(agentId: string): Promise<ProviderConfig> {
  return get(`/api/v1/agents/${agentId}/provider-config`, {
    headers: { 'X-API-Key': localStorage.getItem('vibecode_token') || '' }
  })
}
```

#### `frontend/src/views/AgentList.vue` (MODIFY)
- **Add inline edit**: In the agents tab table, add edit button next to name column
- **State**: `editingAgentId: ref<number | null>(null)`, `editName: ref('')`
- **Template**: Replace `{{ agent.name }}` with conditional: show input when editing, text when not
- **Actions**: Save on blur/Enter, cancel on Escape

#### `backend/src/__tests__/agentEdit.test.js` (CREATE)
- Test `PUT /api/agents/:agentId` — happy path, validation, authorization
- Test `GET /api/v1/agents/:agentId/provider-config` — happy path, no provider, wrong key

#### `frontend/src/__tests__/agentEdit.test.ts` (CREATE)
- Test inline edit mode — enter edit, save, cancel
- Test API client function calls

---

### d) Dependencies

- PoolManager DB record creation depends on AgentService.create() existing
- Provider config fetch depends on AgentService.getProviderConfig() and ProviderService.decrypt()
- Frontend inline edit depends on API client functions existing
- All Java agent changes depend on Maven build succeeding

---

### e) Risks/Edge Cases

- **PoolManager DB records**: Ephemeral pool agents create DB records. Must clean up on release. Risk: container crash before release leaves orphan records. Mitigation: Add a periodic cleanup of pool agents not in the pool map.
- **Provider config fetch timing**: Agent fetches config during construction, before heartbeat scheduler starts. If backend is slow, agent startup may be delayed. Mitigation: 10-second timeout on fetch.
- **Agent rename race**: Two users renaming same agent simultaneously. Mitigation: Optimistic update with 404 error handling on frontend.

---

### f) Testing

#### Backend Unit Tests — `backend/src/__tests__/agentEdit.test.js`
```
✓ [happy] PUT /api/agents/:id updates name and returns updated agent
✓ [error] PUT /api/agents/:id with empty name returns 400
✓ [error] PUT /api/agents/:id for another user's agent returns 404
✓ [happy] GET /api/v1/agents/:id/provider-config returns decrypted config
✓ [error] GET /api/v1/agents/:id/provider-config without X-API-Key returns 401
✓ [error] GET /api/v1/agents/:id/provider-config for agent without provider returns 404
```

#### Frontend Unit Tests — `frontend/src/__tests__/agentEdit.test.ts`
```
✓ [ui] AgentList shows edit button next to agent name
✓ [ui] Clicking edit shows input field with current name
✓ [ui] Saving edit calls updateAgentName API
✓ [ui] Canceling edit discards changes
```

---

### g) Files Changed

**Backend:**
```
backend/src/services/PoolManager.js           → MODIFY
backend/src/services/HeartbeatService.js      → MODIFY (none needed, already exported)
backend/src/index.js                          → MODIFY
backend/src/api/agents.js                     → MODIFY
backend/src/services/AgentService.js          → MODIFY
backend/src/validators/agents.js              → MODIFY
backend/src/__tests__/agentEdit.test.js       → CREATE
```

**Java Agent:**
```
agent/Dockerfile                              → MODIFY
agent/.../config/AgentConfig.java             → MODIFY
agent/.../AgentApp.java                       → MODIFY
agent/.../service/ApiService.java             → MODIFY
agent/.../service/TicketProcessor.java        → MODIFY
agent/.../service/GitHubService.java          → MODIFY
```

**Frontend:**
```
frontend/src/router/index.ts                  → MODIFY
frontend/src/api/agents.ts                    → MODIFY
frontend/src/views/AgentList.vue              → MODIFY
frontend/src/__tests__/agentEdit.test.ts      → CREATE
```

---

### h) Post-Deploy Verification

1. Backend: `npm test` passes
2. Backend: `npm run lint` passes
3. Frontend: `npm run lint` passes
4. Frontend: `npm run typecheck` passes
5. Frontend: `npm run build` passes
6. Pool agent starts with correct env vars
7. Agent fetches provider config from backend
8. Agent rename works via API and UI
9. Stale agents marked offline after 60s timeout
10. Docker health check reports healthy
