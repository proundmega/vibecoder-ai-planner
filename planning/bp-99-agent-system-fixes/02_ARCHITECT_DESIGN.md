# 02_ARCHITECT_DESIGN.md — Agent System Fixes & Feature Completion

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend | Java Agent | Frontend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, `04_SPECIFICATION.md`

---

## Problem Statement

The agent system has 12 issues discovered during a comprehensive scan. Critical blockers prevent pool-managed agents from authenticating (env var mismatch, ID type mismatch). Several planned features (provider config fetch, agent rename) remain unimplemented. Multiple code quality issues (stale agent cleanup, message ordering, deprecated methods) degrade reliability.

---

## Design

### Issue 1: PoolManager env var mismatch
**Current**: `PoolManager.js:59` passes `API_KEY=${apiKey}`
**Agent reads**: `AgentConfig.java:47` requires `AGENT_API_KEY`
**Fix**: Change PoolManager to pass `AGENT_API_KEY=${apiKey}`

### Issue 2: PoolManager ID type mismatch
**Current**: PoolManager generates hex IDs; heartbeat endpoint compares against BIGSERIAL DB IDs
**Fix**: PoolManager creates a DB agent record when requesting a pool agent by calling `AgentService.create()` internally. The returned DB ID is used for heartbeat reporting.

### Issue 3: Dead TerminalView backend
**Current**: `TerminalView.vue` connects to WebSocket `/api/terminal/:id`, no backend route
**Fix**: Remove the route from `frontend/src/router/index.ts`. Keep TerminalView.vue as a placeholder.

### Issue 4: Broken Docker health check
**Current**: `HEALTHCHECK ... http://localhost:8080/health` — agent has no HTTP server
**Fix**: Replace with `CMD pgrep -f "java -jar agent.jar" || exit 1`

### Issue 5: Stale agent cleanup never called
**Current**: `HeartbeatService.cleanupStaleAgents()` exists but no scheduler calls it
**Fix**: Add a `setInterval` in `index.js` that calls `cleanupStaleAgents()` every 5 minutes.

### Issue 6-7: bp-02 Provider Config Fetch
**Backend endpoint**: `GET /api/v1/agents/:agentId/provider-config`
- Auth: X-API-Key header (agent's own key)
- Logic: Verify agent by API key -> check agent has provider_id -> join providers table -> decrypt api_key_encrypted -> return config
- Returns 404 if no provider_id or provider not found

**Java agent**: In `AgentApp.createAiProvider()`, before creating the provider:
1. Call `apiService.getProviderConfig(agentId)`
2. If successful, use returned config to create the provider
3. If failed, log warning and fall back to env vars

**ApiService addition**: Add `getProviderConfig(String agentId)` method

### Issue 8-9: bp-77 Agent Rename
**Backend**: `PUT /api/agents/:agentId` in `agents.js`
- Auth: verifyTokenOrAgent + AGENT_REVOKE permission
- Body: `{ name: string }` (1-100 chars)
- Service: `AgentService.updateName(agentId, name, userId)`

**Frontend**: In `AgentList.vue` agents tab:
- Add edit icon button next to each agent name
- Clicking edit replaces name text with input field
- Save on Enter/blur, cancel on Escape

### Issue 10: TicketProcessor message ordering
**Current**: "Started working" message posted at line 137, AFTER file operations
**Fix**: Move the postMessage call to right after ticket pickup (after line 79)

### Issue 11: GitHubService.createCommit() stub
**Current**: No parent SHA in commit body
**Fix**: Get latest commit SHA from branch, add to commit body as `parent`

### Issue 12: AGENT_ID optional but required
**Current**: `AgentConfig.java:48` uses `getEnv("AGENT_ID", null)`
**Fix**: Change to `requireEnv("AGENT_ID")`

### Issue 13: AgentService.getApiKey() deprecated
**Current**: Reads `api_key` column removed by migration 033
**Fix**: Remove `getApiKey()`. Keep `revokeApiKey()` but change to set `api_key_hash = NULL`.

### Issue 14: Planning docs fetch separate client
**Current**: `TicketProcessor.fetchPlanningDocs()` creates new OkHttpClient
**Fix**: Use apiService's existing httpClient instance

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/services/PoolManager.js` | MODIFY | Fix env var name, create DB record for pool agents |
| `backend/src/services/HeartbeatService.js` | MODIFY | Add scheduled cleanup |
| `backend/src/index.js` | MODIFY | Start heartbeat cleanup scheduler |
| `backend/src/api/agents.js` | MODIFY | Add PUT + GET provider-config routes |
| `backend/src/services/AgentService.js` | MODIFY | Add updateName, getProviderConfig; clean deprecated |
| `backend/src/validators/agents.js` | MODIFY | Add updateAgentSchema |
| `agent/.../config/AgentConfig.java` | MODIFY | Make AGENT_ID required |
| `agent/.../AgentApp.java` | MODIFY | Fetch provider config at startup |
| `agent/.../service/ApiService.java` | MODIFY | Add getProviderConfig method |
| `agent/.../service/TicketProcessor.java` | MODIFY | Fix message ordering + reuse client |
| `agent/.../service/GitHubService.java` | MODIFY | Fix createCommit parent SHA |
| `agent/Dockerfile` | MODIFY | Fix health check |
| `frontend/src/router/index.ts` | MODIFY | Remove terminal route |
| `frontend/src/api/agents.ts` | MODIFY | Add updateAgentName, getProviderConfig |
| `frontend/src/views/AgentList.vue` | MODIFY | Add inline edit |
| `backend/src/__tests__/agentEdit.test.js` | CREATE | Tests for PUT + provider-config |
| `frontend/src/__tests__/agentEdit.test.ts` | CREATE | Tests for inline edit |

---

## Risks and Edge Cases

### Backend Risks
- **PoolManager DB record creation**: Pool agents are ephemeral. Creating DB records for them may accumulate stale records. Mitigation: PoolManager should delete the DB record when releasing the container.
- **Heartbeat cleanup timing**: 5-minute interval means stale agents can stay "online" for up to 5 minutes. Acceptable for current scale.

### Java Agent Risks
- **Provider config fetch failure**: If backend is unreachable at startup, agent should fall back to env vars (not crash). Log warning.
- **Agent ID from pool**: When PoolManager creates a DB record, it gets a BIGSERIAL ID back. This ID must be passed to the container as `AGENT_ID`.

### Frontend Risks
- **Inline edit race condition**: If agent name changes between load and edit, save should detect conflict. Mitigation: Optimistic update with error handling.

---

## Alternative Designs Considered

### Alternative for Issue 2 (PoolManager ID): Skip DB for pool agents
- **Pros**: Simpler, no stale DB records
- **Cons**: Heartbeat endpoint can't verify pool agents via API key lookup
- **Decision**: Use DB records with cleanup on release (cleaner integration with existing auth flow)

### Alternative for Issue 13 (Deprecated getApiKey): Deprecate with warning
- **Pros**: Backward compatible
- **Cons**: Dead code remains, confusion about which method to use
- **Decision**: Remove entirely — no callers found in codebase

---

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket |
|---|-------------|-------------|----------|----------------------|
| 1 | bp-02 | Usage reporting and billing | Observability | bp-04-usage-billing |
| 2 | bp-77 | Audit log for name changes | Audit | bp-84-agent-audit-log |
| 3 | bp-99 | WebSocket terminal proxy for agent containers | Developer Experience | bp-85-agent-terminal |
| 4 | bp-99 | Agent container log streaming endpoint | Observability | bp-86-agent-logs |
