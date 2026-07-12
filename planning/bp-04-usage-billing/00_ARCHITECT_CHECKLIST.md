# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: pending
**Date started**: 2026-07-12
**Date completed**: {{DATE}}
**Author**: AI Assistant
**Feature scope**: Backend | Java Agent

---

## Pre-Implementation Checklist

### Planning

- [ ] I have read `01_ARCHITECT_REQUIREMENT.md` — I understand the requirement
- [ ] I have read `02_ARCHITECT_DESIGN.md` — I understand the design
- [ ] I have read `03_ARCHITECT_IMPLEMENTATION.md` — I know the actions and dependencies
- [ ] I have identified all assumptions and confirmed they are reasonable
- [ ] I know what is IN scope and OUT of scope

### Existing Infrastructure Audit

- [ ] I have checked `UsageLogger.js` — `log()` method fully implemented but **never called** in production
- [ ] I have checked `BillingService.js` — `aggregateDailyBilling()`, `getProjectBilling()`, `getUsageSince()` all implemented
- [ ] I have checked `usage_logs` table — has `provider_type`, `model`, `agent_id`, `project_id`, `cost_usd`
- [ ] I have checked `project_billing` table — empty, never populated
- [ ] I have checked `pricing.js` — `MODEL_PRICING` map + `calculateCost()` implemented
- [ ] I have checked Java agent providers — `ClaudeProvider`, `OpenAiProvider`, `OpenAiCompatibleProvider` make API calls but don't report usage
- [ ] I have checked backend providers — `ClaudeProvider`, `OpenAIProvider`, `GenericProvider` return `usage` from `chat()` but nothing consumes it
- [ ] I have checked `agent_actions` table — tracks generic agent actions at flat $0.05/action
- [ ] I have checked usage API routes — `GET /usage/projects/:id/usage`, `GET /usage/users/me/usage`
- [ ] I have checked billing API routes — `GET /billing/projects/:id/billing`, `GET /billing/users/me/billing`

### Database & Migration

- [ ] No new DB tables needed — `usage_logs` and `project_billing` exist
- [ ] `usage_logs` has `agent_id` column — but references `users(id)`, not `agents(id)` — **data type mismatch to verify**
- [ ] `usage_logs` has `provider_type` and `model` columns — already populated by UsageLogger

### Testing Strategy

- [ ] Backend: Test `UsageLogger.log()` inserts correct row
- [ ] Backend: Test `BillingService.aggregateDailyBilling()` groups correctly
- [ ] Backend: Test usage API returns correct data
- [ ] Backend: Test billing API returns correct data
- [ ] Java agent: Test usage reporting endpoint
- [ ] Java agent: Test usage is sent after each AI call

### Configuration Audit

- [ ] No new environment variables needed
- [ ] Existing `MODEL_PRICING` in `pricing.js` — may need updates for new models

---

## Post-Implementation Checklist

- [ ] Backend: `npm test` passes
- [ ] Backend: `npm run lint` passes
- [ ] Java agent: Compiles with `mvn clean package`
- [ ] Usage logged after each AI call in Java agent
- [ ] `usage_logs` table populated with real data
- [ ] `BillingService.aggregateDailyBilling()` can be scheduled (cron or manual)
- [ ] Usage API returns provider-level breakdown
- [ ] Billing API returns project-level costs

---

## When to Ask the User

1. **Usage reporting timing** — Should the Java agent report usage synchronously after each AI call (slower but accurate), or batch and report periodically (faster but potential data loss)?
2. **Billing aggregation scheduling** — Should `aggregateDailyBilling()` run on a cron schedule, be triggered on-demand via API, or both?
3. **Agent_id in usage_logs** — The column references `users(id)` but should reference `agents(id)`. Since there's no data, we can fix this. Confirm: should `agent_id` FK point to `agents.id` instead of `users.id`?

---

*This checklist prevents agents from skipping planning and jumping straight to coding.*
