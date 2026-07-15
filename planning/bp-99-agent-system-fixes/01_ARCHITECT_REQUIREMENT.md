# 01_ARCHITECT_REQUIREMENT.md — Agent System Fixes & Feature Completion

**Status**: planned
**Date created**: 2026-07-15
**Date completed**: {{YYYY-MM-DD}}
**Author**: AI Assistant
**Scope**: Backend | Java Agent | Frontend
**Priority**: P1
**Effort**: Large

---

## Requirement

A comprehensive scan of the agent system revealed 12 issues ranging from critical blockers to minor improvements. This ticket consolidates all fixes into a single implementation, covering:

1. **PoolManager env var mismatch** — PoolManager passes `API_KEY=` but agent reads `AGENT_API_KEY`
2. **PoolManager ID type mismatch** — PoolManager generates hex IDs, DB uses BIGSERIAL
3. **Dead TerminalView backend** — WebSocket route `/api/terminal/:id` doesn't exist
4. **Broken Docker health check** — Agent Dockerfile checks port 8080 but agent is a CLI app
5. **Stale agents never cleaned up** — `HeartbeatService.cleanupStaleAgents()` exists but is never called
6. **bp-02: Provider config not fetched by agents** — Java agent reads AI config from env vars only
7. **bp-77: No agent rename** — No PUT endpoint to edit agent names
8. **TicketProcessor message ordering** — "Started working" posted after files committed
9. **GitHubService.createCommit() stub** — Missing parent SHA
10. **AGENT_ID optional but required** — Config reads as nullable but heartbeat uses it
11. **AgentService.getApiKey() deprecated** — Reads plaintext column removed by migration 033
12. **Planning docs fetch uses separate OkHttpClient** — Should reuse apiService's connection pool

---

## Existing Infrastructure Audit

### Backend API Check
- [x] Agent routes exist: `backend/src/api/agents.js`
- [x] AgentService exists: `backend/src/services/AgentService.js`
- [x] HeartbeatService exists: `backend/src/services/HeartbeatService.js`
- [x] PoolManager exists: `backend/src/services/PoolManager.js`
- [x] ProviderService exists: `backend/src/services/ProviderService.js`
- [x] Encryption utilities exist: `backend/src/utils/encryption.js`
- [ ] **New endpoint needed**: `PUT /api/agents/:agentId` (bp-77)
- [ ] **New endpoint needed**: `GET /api/v1/agents/:agentId/provider-config` (bp-02)

### Java Agent Check
- [x] AgentConfig.java reads env vars
- [x] ApiService.java exists with HTTP client
- [x] AgentApp.java orchestrates startup
- [x] TicketProcessor.java processes tickets
- [x] GitHubService.java handles GitHub API
- [ ] **Agent needs to fetch provider config at startup** (bp-02)

### Frontend Check
- [x] AgentList.vue exists with CRUD tabs
- [x] agents.ts API client exists
- [x] TerminalView.vue exists (but backend missing)
- [x] Router has `/agents/:id/terminal` route

### Key Insight

This is a multi-layer fix covering backend, Java agent, and frontend. The most critical issues (env var mismatch, ID type mismatch) block the pool-managed agent flow entirely. The provider config fetch (bp-02) and agent rename (bp-77) are existing planned tickets that should be implemented together.

---

## Scope

### In Scope
1. **PoolManager**: Fix env var name (`API_KEY` -> `AGENT_API_KEY`)
2. **PoolManager**: Fix agent ID to use UUID format matching DB
3. **TerminalView**: Remove dead route from router (backend doesn't exist)
4. **Dockerfile**: Replace HTTP health check with process-alive check
5. **HeartbeatService**: Add scheduled cleanup of stale agents
6. **bp-02**: New backend endpoint `GET /api/v1/agents/:agentId/provider-config`
7. **bp-02**: Java agent fetches provider config at startup
8. **bp-77**: Backend `PUT /api/agents/:agentId` endpoint
9. **bp-77**: Frontend inline edit in AgentList.vue
10. **TicketProcessor**: Move "Started working" message before processing
11. **GitHubService**: Fix createCommit to get parent SHA first
12. **AgentConfig**: Make AGENT_ID required (use requireEnv)
13. **AgentService**: Remove deprecated getApiKey() and revokeApiKey() methods
14. **TicketProcessor**: Reuse apiService's OkHttpClient for planning docs fetch

### Out of Scope
- Java agent unit tests (no existing Java test infrastructure)
- Runtime provider config reload (agent restart required)
- Usage reporting/billing (deferred to bp-04)
- Prometheus metrics for agent health (deferred to bp-76)
- Agent container log streaming (separate feature)
- WebSocket terminal proxy implementation (deferred)

---

## Deferred Improvements Found (Internal Tracking)

| # | From Ticket | Improvement | Category | Suggested Next Ticket |
|---|-------------|-------------|----------|----------------------|
| 1 | bp-02 | Usage reporting and billing | Observability | bp-04-usage-billing |
| 2 | bp-77 | Audit log for name changes | Audit | bp-84-agent-audit-log |
| 3 | bp-99 | WebSocket terminal proxy for agent containers | Developer Experience | bp-85-agent-terminal |
| 4 | bp-99 | Agent container log streaming endpoint | Observability | bp-86-agent-logs |

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/services/PoolManager.js` | MODIFY | Fix env var name + ID format |
| `backend/src/services/HeartbeatService.js` | MODIFY | Add scheduled cleanup |
| `backend/src/api/agents.js` | MODIFY | Add PUT + GET provider-config routes |
| `backend/src/services/AgentService.js` | MODIFY | Add updateName, getProviderConfig; remove deprecated methods |
| `backend/src/validators/agents.js` | MODIFY | Add updateAgentSchema |
| `agent/src/main/java/.../config/AgentConfig.java` | MODIFY | Make AGENT_ID required |
| `agent/src/main/java/.../AgentApp.java` | MODIFY | Fetch provider config at startup |
| `agent/src/main/java/.../service/ApiService.java` | MODIFY | Add getProviderConfig method |
| `agent/src/main/java/.../service/TicketProcessor.java` | MODIFY | Fix message ordering + reuse client |
| `agent/src/main/java/.../service/GitHubService.java` | MODIFY | Fix createCommit parent SHA |
| `agent/Dockerfile` | MODIFY | Fix health check |
| `frontend/src/router/index.ts` | MODIFY | Remove /agents/:id/terminal route |
| `frontend/src/api/agents.ts` | MODIFY | Add updateAgentName, getProviderConfig |
| `frontend/src/views/AgentList.vue` | MODIFY | Add inline edit + use updated API |
| `backend/src/__tests__/agentEdit.test.js` | CREATE | Backend tests for PUT + provider-config |
| `frontend/src/__tests__/agentEdit.test.ts` | CREATE | Frontend tests for inline edit |

---

## Acceptance Criteria

1. [ ] PoolManager passes `AGENT_API_KEY=` env var (not `API_KEY=`)
2. [ ] PoolManager generates UUID-format agent IDs (not hex)
3. [ ] TerminalView route removed from router (no dead route)
4. [ ] Agent Dockerfile health check uses process-alive (not HTTP)
5. [ ] Stale agents are cleaned up every 5 minutes
6. [ ] `GET /api/v1/agents/:agentId/provider-config` returns decrypted config
7. [ ] Java agent fetches provider config at startup, falls back to env vars
8. [ ] `PUT /api/agents/:agentId` updates agent name with validation
9. [ ] AgentList.vue has inline name editing
10. [ ] "Started working" message posted before ticket processing
11. [ ] GitHubService.createCommit() includes parent SHA
12. [ ] AGENT_ID is required env var
13. [ ] AgentService.getApiKey() removed (deprecated)
14. [ ] TicketProcessor reuses apiService's OkHttpClient

---

## Out of Scope

- Java agent unit tests
- Runtime provider config reload
- Usage reporting (bp-04)
- WebSocket terminal proxy
- Prometheus metrics for agent health (bp-76)
