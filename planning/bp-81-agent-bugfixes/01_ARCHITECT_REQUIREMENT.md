# BP-81: Agent Bugfixes — Architect Requirement

## Header

| Field | Value |
|-------|-------|
| **Status** | Ready for Implementation |
| **Date** | 2026-07-14 |
| **Author** | opencode |
| **Scope** | Backend services, API routes, frontend components |
| **Priority** | P1 (High) |
| **Effort** | Small |
| **Ticket ID** | BP-81 |

## Requirement

Four bugs prevent the agent system from working correctly:

1. **Agent detail page fails for newly created agents** — The detail page queries `agent_heartbeats` as the primary table. Agents that have never sent a heartbeat have no row in `agent_heartbeats`, causing a 404 error. The frontend displays "Failed to load agent detail".

2. **Create agent form is missing configurable fields** — The form only collects `name` and `providerId`. The backend hardcodes `rate_limit=100`, `max_actions_per_day=1000`, and `api_key_expires_at=30 days`. Users cannot customize these values at creation time.

3. **`AgentService.getAgentDailyLimit()` crashes** — The SQL query uses `$1` and `$2` placeholders but no parameter array is passed to `pool.query()`. This throws a PostgreSQL error if ever called.

4. **Joi validation schema missing `providerId`** — The `createAgentSchema` only validates `name`. The `providerId` field is accepted by the route handler but not validated, allowing any type to be sent.

## Existing Infrastructure Audit

### Backend API
- `POST /api/v1/agents/create` — Creates agent (missing `providerId` validation)
- `GET /api/v1/agents-status/:id` — Agent detail (queries wrong table)
- `AgentService.getAgentDailyLimit()` — Missing SQL parameters

### Frontend API Client
- `createAgent(name, providerId)` — Only sends `name` and `providerId`
- `fetchAgentDetail(agentId)` — Calls the broken endpoint

### Frontend UI
- `AgentModal.vue` — Only has `name` and provider dropdown fields
- `AgentDetail.vue` — Calls `fetchAgentDetail` which fails

## Scope

### In Scope
1. Fix `HeartbeatService.getAgentStatus()` to query from `agents` table
2. Add `rate_limit`, `max_actions_per_day`, `api_key_expires_at` fields to create form
3. Fix `AgentService.getAgentDailyLimit()` missing SQL parameters
4. Add `providerId` to Joi validation schema
5. Update frontend API client to send new fields
6. Regression tests for all four fixes

### Out of Scope
- Agent edit/update form (bp-77 covers agent edit name)
- Agent key rotation UI improvements
- Agent memory/pgvector features
- Agent container spawning (PoolManager)
- Agent terminal access (super_admin only)
- Real-time agent status WebSocket updates

## Pending Scope Items to Present to User

From previously committed tickets' "Out of Scope" sections:

| Category | Item | Source |
|----------|------|--------|
| Security | API key rotation/expiry UI | bp-74 |
| Security | Account lockout for agents | bp-71 |
| Observability | Prometheus metrics for agents | bp-76 |
| Infrastructure | Agent container pooling | bp-80 |
| UX | Rate limit countdown UI | bp-72 |
| Testing | Cypress component tests for agent forms | bp-69 |

## Impact Analysis

| Layer | Change Type | Files Affected |
|-------|-------------|----------------|
| Backend Service | Fix | `HeartbeatService.js` (getAgentStatus) |
| Backend Service | Fix | `AgentService.js` (getAgentDailyLimit) |
| Backend API | Fix | `agents.js` (Joi schema) |
| Backend API | Enhance | `agents.js` (create endpoint accepts new fields) |
| Frontend Component | Enhance | `AgentModal.vue` (add fields) |
| Frontend API | Enhance | `agents.ts` (update createAgent signature) |
| Backend Tests | Extend | `agentService.test.js` |
| Frontend Tests | Extend | `agents.test.js` |

## Acceptance Criteria

- [ ] Agent detail page loads for agents with no heartbeat (shows "offline" status)
- [ ] Agent detail page loads for agents with heartbeat (shows status + history)
- [ ] Create agent form shows `rate_limit`, `max_actions_per_day`, and key expiry fields
- [ ] Creating agent with custom values persists them to the database
- [ ] Creating agent without custom values uses defaults (100, 1000, 30 days)
- [ ] `getAgentDailyLimit()` executes without throwing
- [ ] Joi rejects invalid `providerId` types (objects, arrays)
- [ ] Joi accepts valid `providerId` (string/number) and null/undefined
- [ ] All existing tests continue to pass
- [ ] Regression tests added for all four fixes

## Performance Considerations

- No performance impact — all changes are to existing queries and UI components
- The `getAgentStatus` fix improves performance by avoiding a unnecessary JOIN from heartbeats

## Security Considerations

- The Joi validation fix prevents malformed `providerId` values from reaching the service layer
- No new attack surface introduced
- All existing auth middleware remains in place

## Testing Checklist

- [x] Test-First: Create empty test stubs before production code
- [ ] Backend unit tests for `getAgentDailyLimit` fix
- [ ] Backend unit tests for `getAgentStatus` fix
- [ ] Frontend unit tests for `createAgent` with new params
- [ ] All existing tests pass
- [ ] Coverage threshold met (60%)

## Anti-Patterns to Avoid

- Do not change the `agents` table schema (no migration needed)
- Do not change the API response shape (frontend depends on it)
- Do not remove existing default values (backward compatibility)
- Do not change auth middleware or permission requirements
