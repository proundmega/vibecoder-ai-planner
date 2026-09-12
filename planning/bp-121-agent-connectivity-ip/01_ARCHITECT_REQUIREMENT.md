# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: planned
**Date created**: 2026-09-11
**Date completed**: {{YYYY-MM-DD}}
**Author**: AI Assistant
**Scope**: Backend
**Priority**: P0
**Effort**: Small

---

## Requirement

Java agents deployed on non-localhost hosts (e.g., `http://192.168.3.50:3000`) fail to function due to three bugs:

1. **CORS blocks non-localhost origins** — The `ALLOWED_ORIGINS` env var defaults to `http://localhost:3000,http://localhost:3002`. When the frontend is accessed via a LAN IP (e.g., `http://192.168.3.50:3000`), the browser sends `Origin: http://192.168.3.50:3000` which is rejected with 403. This blocks ALL API calls including agent heartbeats, provider config fetch, and agent listing.

2. **Provider config response is double-wrapped** — `AgentService.getProviderConfig()` returns `{ success: true, data: {...} }` and the route handler wraps it again: `res.json({ success: true, data: config })` → `{ success: true, data: { success: true, data: {...} } }`. The Java agent at `agent/src/main/java/com/vibecode/agent/service/ApiService.java` parses `response.getData()` expecting `{ provider_type, api_key, base_url, model, max_tokens }` but gets `{ success, data }` instead. This was identified in bp-120 as a P0 bug but was never implemented.

3. **Agent listing queries FROM agent_heartbeats** — `HeartbeatService.getAllAgents()` queries `FROM agent_heartbeats ah LEFT JOIN agents a` so agents without heartbeats don't appear in the heartbeat tab. The query should be `FROM agents a LEFT JOIN agent_heartbeats ah` so all registered agents appear regardless of heartbeat status. This was also identified in bp-120 but never fixed.

---

## Existing Infrastructure Audit

### Backend API Check
- [x] API route exists: `backend/src/api/agents.js` — YES (provider-config route at line 327)
- [x] Controller exists: N/A (routes directly call services)
- [x] Service exists: `backend/src/services/AgentService.js` — YES (getProviderConfig at line 147)
- [x] Service exists: `backend/src/services/HeartbeatService.js` — YES (getAllAgents at line 46)
- [x] Route is mounted: `backend/src/api/v1/index.js` — YES
- [x] OpenAPI JSDoc annotations exist — YES (on agentHeartbeat.js)
- [x] CORS middleware exists: `backend/src/middleware/cors.js` — YES (strict allowlist)

### Frontend API Client Check
- [x] API client exists: `frontend/src/api/agents.ts` — YES
- [x] API client functions cover all needed endpoints — YES
- [x] API client follows existing patterns — YES

### Frontend UI Check
- [x] View component exists: `frontend/src/views/AgentList.vue` — YES (heartbeat tab + agents tab)
- [x] Route exists: `frontend/src/router/index.ts` — YES

### Integration Check
- [x] Frontend API client can call existing backend endpoints — YES
- [x] Response shapes match — NO (provider config double-wrap mismatch)
- [x] Auth tokens are used correctly — YES
- [x] Error handling matches existing patterns — YES

### Key Insight

This is a **BACKEND-ONLY** task. All three bugs are in backend code:
- CORS configuration in `backend/src/index.js` + `docker-compose.override.yml`
- Provider config double-wrapping in `backend/src/services/AgentService.js` + `backend/src/api/agents.js`
- Agent listing SQL in `backend/src/services/HeartbeatService.js`

No frontend changes, no database migrations, no new files needed.

---

## Scope

### In Scope
- Fix CORS: extend default `ALLOWED_ORIGINS` to include `http://127.0.0.1:3000` and `http://127.0.0.1:3002` in production docker-compose.yml (already in override)
- Fix provider config double-wrapping: remove `{ success, data }` wrapper from `AgentService.getProviderConfig()` return value
- Fix agent listing SQL: change `FROM agent_heartbeats ah LEFT JOIN agents a` to `FROM agents a LEFT JOIN agent_heartbeats ah` in `HeartbeatService.getAllAgents()`
- Add regression tests for all three fixes
- Update `docker-compose.override.yml` to include `http://192.168.3.50:3000` as an example for LAN deployments

### Out of Scope
- Frontend changes (no frontend code needs modification)
- Database migrations (no schema changes)
- New environment variables (using existing `ALLOWED_ORIGINS`)
- Agent self-registration (agents must be created by admin — this is by design)
- WebSocket terminal proxy fixes (separate concern)
- PoolManager BACKEND_URL fix (separate concern — Docker hostname resolution)
- SSRF protection for generic provider (separate concern — `ALLOW_PRIVATE_HOSTS`)

---

## Pending Scope Items to Present to User

**MANDATORY**: Before presenting this ticket to the user, list all deferred improvements found in previous tickets' "Out of Scope" sections that are relevant to this ticket's domain. The user must be aware of follow-up work before approving implementation.

### Items to Present

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-120 | Provider config double-wrapping fix | Bug Fix | bp-121 (this ticket) | ☐ |
| 2 | bp-120 | Agent listing FROM agents (not heartbeats) | Bug Fix | bp-121 (this ticket) | ☐ |
| 3 | bp-120 | Defensive Java agent parsing for double-wrapped responses | Java Agent | Agent ticket | ☐ |

**Note**: bp-120 was marked "Planned" but never implemented. Items 1 and 2 are being pulled into this ticket. Item 3 (defensive Java agent parsing) is deferred to a future agent-side ticket as a transition-period safety net.

---

## Deferred Improvements Found (Internal Tracking)

For internal tracking — these are the same items above but without the "User Notified" column. Create follow-up tickets for each item.

| # | From Ticket | Improvement | Category | Suggested Next Ticket |
|---|-------------|-------------|----------|----------------------|
| 1 | bp-120 | Provider config double-wrapping fix | Bug Fix | bp-121 (this ticket) |
| 2 | bp-120 | Agent listing FROM agents (not heartbeats) | Bug Fix | bp-121 (this ticket) |
| 3 | bp-120 | Defensive Java agent parsing for double-wrapped responses | Java Agent | Future agent ticket |

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/services/AgentService.js` | MODIFY | Remove `{ success, data }` wrapper from `getProviderConfig()` return (line 159) |
| `backend/src/services/HeartbeatService.js` | MODIFY | Swap FROM/JOIN order in `getAllAgents()` (line 47-63) |
| `docker-compose.override.yml` | MODIFY | Add `http://192.168.3.50:3000` to ALLOWED_ORIGINS for LAN deployment example |
| `docker-compose.yml` | MODIFY | Add `http://127.0.0.1:3000,http://127.0.0.1:3002` to production ALLOWED_ORIGINS default |
| `backend/src/__tests__/agentProviderConfig.test.js` | CREATE | Regression test for double-wrap fix |
| `backend/src/__tests__/agentListing.test.js` | CREATE | Regression test for agent listing fix |
| `backend/src/__tests__/corsValidation.test.js` | EXTEND | Add non-localhost origin tests |

---

## Known Unknowns

Things that could change the approach if the answer is different from assumed:

1. **[Java agent response parsing]**: The Java agent's `ApiService.getProviderConfig()` parses `response.getData()`. If it accesses a nested `data.data` path (double-nested), fixing the backend to single-wrap will break the Java agent's current parsing. **Resolution**: Check `agent/src/main/java/com/vibecode/agent/service/ApiService.java` to verify how it parses the response. If it expects double-wrapped, both backend and agent need fixing.

2. **[CORS impact on existing deployments]**: Adding `127.0.0.1` origins to the production default won't break existing deployments (it's additive), but adding `192.168.3.50` to override is just an example. **Resolution**: Only add `127.0.0.1` to production default (common dev pattern). The `192.168.x.x` IPs are deployment-specific and should be configured per-instance via `ALLOWED_ORIGINS` env var.

---

## Important Design Decisions

**DECISION POINTS** — Items that need user confirmation. List only items that genuinely need user input.

1. **Production ALLOWED_ORIGINS default** — Should the production `docker-compose.yml` default include `127.0.0.1:3000` and `127.0.0.1:3002` in addition to `localhost`? This is a common dev pattern and is already in the override. **Recommendation: Yes, add them.** They are additive and won't break anything.

2. **Java agent compatibility** — Does the Java agent's `ApiService.getProviderConfig()` expect single-wrapped or double-wrapped response? If it expects double-wrapped (matching the buggy backend), fixing the backend alone will break the agent. **Recommendation: Fix backend only; add defensive parsing in a future agent ticket.** The Java agent should be resilient to the response shape.

**If no decisions need user input, write: "No design decisions require user input. All choices follow existing patterns."**

---

## Acceptance Criteria

1. [ ] [Backend] `GET /api/v1/agents/:agentId/provider-config` returns `{ success: true, data: { provider_type, api_key, base_url, model, max_tokens } }` — single-wrapped, not double-wrapped
2. [ ] [Backend] `GET /api/v1/agents-status` returns ALL registered agents, including those without heartbeats
3. [ ] [Backend] Requests from `http://127.0.0.1:3000` and `http://127.0.0.1:3002` are allowed by CORS (not just localhost)
4. [ ] [Backend] `AgentService.getProviderConfig()` returns `{ provider_type, api_key, base_url, model, max_tokens }` directly (no `{ success, data }` wrapper)
5. [ ] [Backend] `HeartbeatService.getAllAgents()` uses `FROM agents a LEFT JOIN agent_heartbeats ah` (not the reverse)
6. [ ] [Backend] New test file `agentProviderConfig.test.js` verifies single-wrap response shape
7. [ ] [Backend] New test file `agentListing.test.js` verifies agents without heartbeats appear in listing
8. [ ] [Backend] CORS test covers `127.0.0.1` origins in addition to `localhost`
9. [ ] [Backend] All existing tests still pass (no regression)
10. [ ] [Backend] `npm run test:coverage` passes (60% min threshold)
11. [ ] [Backend] `npm run lint` passes
12. [ ] [Backend] Bash integration suite passes (`cd backend && bash integration-test/run.sh --only`)

---

## Out of Scope

- Frontend code changes (AgentList.vue, agents.ts API client)
- Database migrations (no schema changes needed)
- New environment variables
- Agent self-registration endpoint (by design, agents are admin-created)
- PoolManager BACKEND_URL Docker hostname resolution (separate issue)
- SSRF protection for generic provider base_url (separate issue)
- WebSocket terminal proxy fixes (separate issue)
- Defensive Java agent parsing for double-wrapped responses (deferred to agent ticket)
- Production deployment configuration (user configures ALLOWED_ORIGINS per instance)

---

## Performance Considerations

- Expected load: minimal (provider config fetched once per agent startup, heartbeats every 30s per agent)
- N+1 queries to avoid: `getAllAgents()` already uses a single JOIN query — no change needed
- Caching strategy: N/A
- Pagination needed: NO — agent counts are typically small (<100)

---

## Security Considerations

- [x] Authentication required: YES — provider-config uses X-API-Key, agents-status uses JWT
- [x] Authorization check: YES — agent auth validates API key matches agent ID
- [x] Input validation: YES — agentId is validated as integer in route params
- [x] Rate limiting: YES — existing rate limiting applies (INTEGRATION_TESTS=1 disables in dev)
- [x] Sensitive data handling: YES — provider API key is decrypted and returned (existing behavior, unchanged)

---

## Testing Checklist

### Test-First Requirement (if 04_SPECIFICATION.md exists)

- [ ] Empty test stub files created BEFORE any production code (listed as first file operations)
- [ ] Test stubs contain imports, `describe` blocks, and stub `it` blocks
- [ ] After implementation: test stubs filled in with actual assertions

### Backend Tests
- [ ] Unit test file CREATED: `backend/src/__tests__/agentProviderConfig.test.js` — tests provider config single-wrap response, agent not found, no provider, provider not found
- [ ] Unit test file CREATED: `backend/src/__tests__/agentListing.test.js` — tests agents without heartbeats appear, agents with heartbeats appear, ordering
- [ ] Unit test file EXTENDED: `backend/src/__tests__/corsValidation.test.js` — add 127.0.0.1 origin tests
- [ ] Every new service method has at least one test case
- [ ] Happy path AND error paths tested (not just happy path)
- [ ] **Coverage threshold (60%)**: `npm run test:coverage` — min 60% lines, functions, branches, statements

### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run test:coverage` — backend coverage threshold passes (60%)
- [ ] `npm run test:integration` — backend integration tests pass (if applicable)
- [ ] `cd backend && bash integration-test/run.sh --only` — bash integration suite passes
- [ ] `npm run lint` — no lint errors
- [ ] `npm run typecheck` — frontend typecheck passes (no frontend changes, should be clean)
- [ ] `npm run build` — frontend build passes (no frontend changes, should be clean)

---

## Anti-Patterns to Avoid

- ❌ **Creating new files when existing ones can be extended** — modify existing services/routes
- ❌ **Duplicating existing patterns** — follow the style of existing service methods
- ❌ **Adding new environment variables** — use existing `ALLOWED_ORIGINS`
- ❌ **Skipping error paths** — test agent not found, no provider, provider not found
- ❌ **Testing only happy paths** — test error cases
- ❌ **Breaking the Java agent** — ensure provider config response shape is correct for Java agent parsing
- ❌ **Skipping the bash integration suite** — `backend/integration-test/run.sh --only` should pass before merging
