# BP-81: Agent Bugfixes — Architect Checklist

## Pre-Implementation Checklist

- [x] Read all 01-04 planning docs for this ticket
- [x] Understand scope: 4 bug fixes across backend services, API routes, frontend components
- [x] No assumptions — all bugs verified with code inspection and test execution
- [x] Read `ai/CODING.md` and `ai/IPEE.md` — IPEE methodology mandatory

## Existing Infrastructure Audit

| Layer | Status | Notes |
|-------|--------|-------|
| Backend API | ✅ Exists | `backend/src/api/agents.js` (7 routes), `backend/src/api/v1/agentHeartbeat.js` (3 routes) |
| Backend Services | ✅ Exists | `AgentService.js` (11 methods), `HeartbeatService.js` (4 methods) |
| Frontend API Client | ✅ Exists | `frontend/src/api/agents.ts` (8 functions) |
| Frontend UI | ✅ Exists | `AgentList.vue`, `AgentDetail.vue`, `AgentModal.vue` |
| Frontend Router | ✅ Exists | `/agents` and `/agents/:id` routes in `router/index.ts` |
| Database Schema | ✅ Exists | `agents` (15 cols), `agent_heartbeats`, `agent_actions` tables |

## Both Frontend AND Backend

- [x] Backend routes exist for all agent operations
- [x] Frontend API client functions exist for all endpoints
- [x] Frontend UI components exist (AgentList, AgentDetail, AgentModal)
- [x] No new routes needed — all fixes are to existing code
- [x] OpenAPI spec update not needed — schema changes are internal

## Dependency Analysis

- [x] No new npm dependencies required
- [x] Existing services affected: `HeartbeatService.js`, `AgentService.js`
- [x] No breaking changes — all fixes are backward-compatible
- [x] No circular dependencies

## Configuration Audit

- [x] No new env vars required
- [x] No config file changes needed
- [x] Backward compatible — existing agents continue to work

## Database & Migration

- [x] No schema changes — all columns already exist
- [x] No new migrations needed
- [x] No rollback required

## Testing Strategy

- [x] Test-First Requirement: Create empty test stubs BEFORE production code
- [x] Backend unit tests: Extend `agentService.test.js` for `getAgentDailyLimit` fix
- [x] Backend unit tests: Add test for `HeartbeatService.getAgentStatus` fix
- [x] Frontend unit tests: Extend `agents.test.js` for `createAgent` with new params
- [x] Coverage threshold: 60% minimum enforced
- [x] Regression test required for each bug fix

## Post-Implementation

- [x] All backend tests pass (`npm test` in `backend/`)
- [x] All frontend tests pass (`npm test -- --run` in `frontend/`)
- [x] Backend lint passes (`npm run lint` in `backend/`)
- [x] Frontend lint passes (`npm run lint` in `frontend/`)
- [x] Frontend typecheck passes (`npm run typecheck` in `frontend/`)
- [x] Coverage threshold met (60%)

## When to Ask the User

- [x] Scope is clear — 4 specific bugs with known fixes
- [x] No ambiguous criteria
- [x] No production impact — all changes are backward-compatible
