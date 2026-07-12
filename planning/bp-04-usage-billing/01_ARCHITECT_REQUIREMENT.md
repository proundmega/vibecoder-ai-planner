# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: planned
**Date created**: 2026-07-12
**Date completed**: {{YYYY-MM-DD}}
**Author**: AI Assistant
**Scope**: Backend | Java Agent
**Priority**: P2
**Effort**: Large

---

## Requirement

The billing/usage tracking system is **fully built but completely disconnected** from the AI call path:

1. **UsageLogger.log()** — fully implemented but only called from tests
2. **BillingService.aggregateDailyBilling()** — fully implemented but never scheduled
3. **Java agent** — makes AI calls directly to OpenAI/Anthropic APIs, never reports token counts back
4. **Backend providers** — have `chat()` methods that return `usage` data, but nothing calls them or logs the result
5. **project_billing** — empty table, no process populates it
6. **pricing.js** — pricing endpoints return hardcoded stubs

This ticket connects the dots: agents report usage after AI calls, the backend logs it, and billing aggregates it.

---

## Existing Infrastructure Audit

### Backend API Check
- [x] UsageLogger exists: `backend/src/services/UsageLogger.js` — `log()`, `getProjectUsage()`, `getUserUsage()`
- [x] BillingService exists: `backend/src/services/BillingService.js` — `aggregateDailyBilling()`, `getProjectBilling()`, `getUserBilling()`, `getUsageSince()`
- [x] Pricing utilities exist: `backend/src/utils/pricing.js` — `MODEL_PRICING`, `calculateCost()`, `getModelPricing()`
- [x] Usage routes exist: `GET /usage/projects/:id/usage`, `GET /usage/users/me/usage`, `GET /usage/pricing/models`
- [x] Billing routes exist: `GET /billing/projects/:id/billing`, `GET /billing/users/me/billing`
- [x] `usage_logs` table exists with all needed columns
- [x] `project_billing` table exists
- [ ] **New endpoint needed**: `POST /api/v1/agents/:agentId/usage` — Java agent reports usage
- [ ] **New endpoint needed**: `POST /api/v1/billing/aggregate` — trigger daily aggregation
- [ ] **Migration needed**: Fix `usage_logs.agent_id` FK to reference `agents(id)` not `users(id)`

### Java Agent Check
- [x] `ClaudeProvider.java` — makes API call, receives response with token counts
- [x] `OpenAiProvider.java` — makes API call, receives response with token counts
- [x] `OpenAiCompatibleProvider.java` — makes API call, receives response with token counts
- [x] `TicketProcessor.java` — calls `aiProvider.generateResponse()`, gets text back
- [ ] **Missing**: Java agents don't send token counts back to backend after AI calls
- [ ] **Missing**: No usage reporting endpoint on backend for agents

### Key Insight

This is a **backend API + Java agent + migration** task. The infrastructure exists but is disconnected. We need to:
1. Fix the `agent_id` FK in `usage_logs`
2. Add a usage reporting endpoint for Java agents
3. Make Java agents report usage after each AI call
4. Wire up the backend provider `chat()` methods to log usage (for non-agent AI calls)
5. Add a scheduling mechanism for `aggregateDailyBilling()`

---

## Scope

### In Scope
- [ ] Database: Fix `usage_logs.agent_id` FK to reference `agents(id)`
- [ ] Backend: New endpoint `POST /api/v1/agents/:agentId/usage` — Java agent reports usage
- [ ] Backend: UsageLogger called from backend provider `chat()` methods
- [ ] Backend: New endpoint `POST /api/v1/billing/aggregate` — trigger daily aggregation
- [ ] Backend: Usage API returns provider-level breakdown (already exists via `getUsageSince()`)
- [ ] Backend: Pricing endpoints return real data from `MODEL_PRICING` (not hardcoded stubs)
- [ ] Java agent: Report usage after each AI call (tokens in/out, cost, duration)
- [ ] Java agent: Usage reporting uses agent's API key for authentication
- [ ] Tests: Backend unit tests for usage logging
- [ ] Tests: Backend integration tests for usage endpoint
- [ ] Tests: Backend unit tests for billing aggregation

### Out of Scope
- [ ] Real-time billing dashboard (UI)
- [ ] Automated cron scheduling (manual trigger via API for now)
- [ ] Usage alerts/thresholds
- [ ] Multi-currency support
- [ ] Invoice generation
- [ ] Stripe/payment gateway integration

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/migrations/033_fix_usage_logs_fk.sql` | CREATE | Fix agent_id FK, add indexes |
| `backend/src/migrations/033_fix_usage_logs_fk_rollback.sql` | CREATE | Rollback FK change |
| `backend/src/migrations/apply.js` | MODIFY | Add 033 to SQL_FILES |
| `backend/src/services/UsageLogger.js` | MODIFY | Add `reportUsage()` for agent reporting |
| `backend/src/services/BillingService.js` | MODIFY | Add `aggregateDailyBilling()` public method, make schedulable |
| `backend/src/api/usage.js` | MODIFY | Add agent usage reporting endpoint |
| `backend/src/api/billing.js` | MODIFY | Add aggregate trigger endpoint |
| `backend/src/api/pricing.js` | MODIFY | Return real pricing data instead of stubs |
| `backend/src/providers/claude/index.js` | MODIFY | Log usage after `chat()` |
| `backend/src/providers/openai/index.js` | MODIFY | Log usage after `chat()` |
| `backend/src/providers/generic/index.js` | MODIFY | Log usage after `chat()` |
| `agent/src/main/java/.../service/TicketProcessor.java` | MODIFY | Report usage after AI call |
| `agent/src/main/java/.../service/ApiService.java` | MODIFY | Add `reportUsage()` method |
| `agent/docker-compose.yml` | MODIFY | (no changes needed) |

---

## Known Unknowns

1. **Agent_id FK**: Currently `usage_logs.agent_id BIGINT REFERENCES users(id)`. Should it reference `agents(id)`? Since there's no data, we can safely change it. The `agents` table has its own `id` column (BIGSERIAL) separate from `users.id`.

2. **Usage reporting timing**: Java agent could report synchronously after each call (accurate but slower) or batch and report periodically (faster but risk of data loss on crash).

3. **Billing aggregation**: Should run daily. Options: cron job, API trigger, or both.

---

## Important Design Decisions

**DECISION 1 — Usage reporting timing (Java agent):**

Option A: Report synchronously after each AI call. Accurate, simple. Risk: if backend is down, usage is lost.
Option B: Batch report every N calls or every N seconds. More resilient, but complex.

**Recommendation**: Option A (synchronous) for simplicity. The agent already has the token counts in memory after the API call. If backend is down, the agent logs a warning and continues — usage data loss is acceptable for now.

**DECISION 2 — Billing aggregation:**

Option A: API trigger only — operator calls `POST /api/v1/billing/aggregate` manually.
Option B: Scheduled task in Node.js — `setInterval` runs daily.
Option C: Both — API trigger + optional scheduled task.

**Recommendation**: Option C. API trigger for manual/CI use. Optional scheduled task for production.

---

## Acceptance Criteria

1. [ ] [DB] `usage_logs.agent_id` references `agents(id)`
2. [ ] [Backend] `POST /api/v1/agents/:agentId/usage` accepts and stores usage report
3. [ ] [Backend] Usage endpoint authenticates via X-API-Key
4. [ ] [Backend] Backend provider `chat()` methods log usage via UsageLogger
5. [ ] [Backend] `POST /api/v1/billing/aggregate` triggers daily aggregation
6. [ ] [Backend] Pricing endpoints return real data from `MODEL_PRICING`
7. [ ] [Backend] `GET /usage/projects/:id/usage` returns provider-level breakdown
8. [ ] [Java Agent] Agent reports usage after each AI call
9. [ ] [Java Agent] Usage includes tokens_in, tokens_out, duration_ms, provider_type, model
10. [ ] [Tests] Backend unit tests for usage logging
11. [ ] [Tests] Backend integration tests for usage endpoint
12. [ ] [Tests] Backend unit tests for billing aggregation

---

## Out of Scope

- Real-time billing dashboard UI
- Automated cron scheduling (API trigger + optional setInterval)
- Usage alerts/thresholds
- Multi-currency, invoices, payment gateways

---

## Security Considerations

- [x] Usage reporting requires valid X-API-Key (agent's own key)
- [x] Agent can only report its own usage (agentId in URL must match authenticated agent)
- [x] Cost calculation uses server-side `MODEL_PRICING` (not client-provided costs)
- [x] No PII in usage reports

---

## Testing Checklist

### Backend Tests
- [ ] `UsageLogger.log()` inserts correct row
- [ ] `POST /api/v1/agents/:agentId/usage` stores usage report
- [ ] `POST /api/v1/agents/:agentId/usage` returns 401 without auth
- [ ] `POST /api/v1/agents/:agentId/usage` returns 403 for wrong agent
- [ ] `BillingService.aggregateDailyBilling()` groups and writes correctly
- [ ] `GET /usage/projects/:id/usage` returns provider breakdown
- [ ] `GET /usage/pricing/models` returns real pricing data
- [ ] Backend provider `chat()` methods call UsageLogger

### Java Agent Testing
- [ ] Agent reports usage after AI call (manual test)
- [ ] Usage includes correct token counts and duration
- [ ] Agent continues working if usage report fails

---

## Anti-Patterns to Avoid

- ❌ **Client-provided costs** — always calculate cost server-side using `MODEL_PRICING`
- ❌ **Skipping usage logging for errors** — log usage even if AI call partially fails (we know token counts)
- ❌ **Hardcoding pricing in multiple places** — single source of truth in `pricing.js`
- ❌ **Creating new billing tables** — reuse existing `usage_logs` and `project_billing`
- ❌ **Ignoring the agent_id FK mismatch** — fix it in migration
- ❌ **Duplicating cost calculation** — use `calculateCost()` from `pricing.js`

---

*Fill in all sections before starting implementation.*
