# 03_ARCHITECT_IMPLEMENTATION.md — Cost Tracking & Usage Logging

**Status**: planned
**Priority**: P2
**Effort**: Medium
**Author**: AI Assistant
**Date created**: 2026-06-10
**Date completed**: TBD
**PR**: TBD
**Branch**: rs-17-cost-tracking

**Dependencies**: rs-14-openai-endpoints (providers need to call usage logger)

---

### a) Purpose

Track AI usage per project and per user: token counts, costs, model usage, call frequency. Provides visibility into AI spending and helps users optimize their provider choices.

**Value delivered**: Users see exactly how much each agent call costs, which models are most expensive, and total project spend. Enables cost-aware decisions (e.g., "use haiku for simple tasks, opus for complex ones").

---

### b) Actions

1. **Create pricing utility** — `backend/src/utils/pricing.js`
   - `MODEL_PRICING` object with per-model input/output prices
   - `calculateCost(model, tokensIn, tokensOut)` → returns USD cost

2. **Create migrations**
   ```
   backend/src/migrations/013_usage_logs.sql
     - usage_logs table with provider, model, tokens, cost, duration
   
   backend/src/migrations/014_project_billing.sql
     - project_billing table (monthly aggregation)
   ```

3. **Create UsageLogger** — `backend/src/services/UsageLogger.js`
   - `log(projectId, userId, agentId, providerType, model, usage, duration, ticketId)`
   - `getProjectUsage(projectId, since, until)` → aggregated by provider/model
   - `getUserUsage(userId, since, until)` → aggregated by project/provider/model

4. **Create BillingService** — `backend/src/services/BillingService.js`
   - `aggregateDailyBilling()` → cron job, aggregates usage_logs → project_billing
   - `getProjectBilling(projectId, month)` → monthly summary
   - `getProjectBillingRange(projectId, start, end)` → range summary
   - `getUserBilling(userId)` → current user's projects billing

5. **Update ProviderInterface** — `backend/src/providers/base/ProviderInterface.js`
   - Wrap `chat()` to call `UsageLogger.log()` after each call
   - Non-blocking: failures logged but don't block agent

6. **Create usageController** — `backend/src/controllers/usageController.js`
   - `getProjectUsage(req, res, next)` → GET `/api/projects/:id/usage`
   - `getUserUsage(req, res, next)` → GET `/api/users/me/usage`
   - `getModelPricing(req, res, next)` → GET `/api/pricing/models`

7. **Create billingController** — `backend/src/controllers/billingController.js`
   - `getProjectBilling(req, res, next)` → GET `/api/projects/:id/billing`
   - `getUserBilling(req, res, next)` → GET `/api/users/me/billing`

8. **Create routes**
   ```
   backend/src/api/usage.js
     GET /api/projects/:id/usage
     GET /api/users/me/usage
     GET /api/pricing/models
   
   backend/src/api/billing.js
     GET /api/projects/:id/billing
     GET /api/users/me/billing
   ```

9. **Create cron job** — `backend/src/jobs/dailyBilling.js`
   - Runs daily, aggregates usage_logs → project_billing

10. **Create tests**
    - `backend/src/__tests__/pricing.test.js` — pricing calculations
    - `backend/src/__tests__/usageLogger.test.js` — usage logging tests
    - `backend/src/__tests__/billingService.test.js` — billing aggregation tests
    - `backend/src/__tests__/billingController.test.js` — controller tests

---

### c) Dependencies

- **rs-14-openai-endpoints** — providers need to call usage logger
- **pricing.js** — model pricing configuration
- **usage_logs table** — new table for usage data

---

### d) Risks/Edge Cases

- **[Pricing accuracy]**: Model pricing changes — pricing.js needs updates, or fetch from provider API
- **[Cost calculation]**: Different providers have different pricing structures — normalize to USD
- **[Data volume]**: High agent activity → many usage rows — add TTL policy (keep 90 days)
- **[Missing usage]**: If usage logging fails, don't block the agent call — log error, continue
- **[Custom models]**: Generic provider may use custom models — allow manual pricing override

---

### e) Testing

#### Unit Tests
- [ ] pricing.calculateCost() — correct cost for known models
- [ ] pricing.calculateCost() — default pricing for unknown models
- [ ] UsageLogger.log() — inserts row with correct values
- [ ] UsageLogger.getProjectUsage() — aggregates correctly
- [ ] UsageLogger.getUserUsage() — aggregates correctly
- [ ] ProviderInterface.chat() — calls UsageLogger.log() after chat

#### Integration Tests
- [ ] Full lifecycle: agent call → usage logged → query usage dashboard
- [ ] Error handling: logging failure doesn't block agent call

---

### f) Migration Notes

```sql
-- Migration: 013_usage_logs.sql
CREATE TABLE IF NOT EXISTS usage_logs (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  user_id BIGINT REFERENCES users(id),
  agent_id BIGINT REFERENCES users(id),
  provider_type VARCHAR(50) NOT NULL,
  model VARCHAR(100) NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_usd DECIMAL(12,6) NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  ticket_id BIGINT REFERENCES tickets(id),
  request_type VARCHAR(50) NOT NULL DEFAULT 'chat',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_usage_logs_project_id ON usage_logs(project_id);
CREATE INDEX idx_usage_logs_user_id ON usage_logs(user_id);
CREATE INDEX idx_usage_logs_agent_id ON usage_logs(agent_id);
CREATE INDEX idx_usage_logs_created_at ON usage_logs(created_at);
CREATE INDEX idx_usage_logs_model ON usage_logs(model);
```

---

### g) Notes

- Usage logging is non-blocking — failures don't affect agent calls
- Pricing in pricing.js is a starting point — can be overridden per-project
- Cost calculated as: `(tokens_in / 1M * input_price) + (tokens_out / 1M * output_price)`
- Duration tracked in ms for performance monitoring
- Plan-based limits (free/pro/enterprise) are future work — schema provided in design doc

---

*This ticket follows the 3 ARCHITECT templates:*
- *`01_ARCHITECT_REQUIREMENT.md` → Requirements, testing checklist, CI requirements*
- *`02_ARCHITECT_DESIGN.md` → Design spec, pricing, usage logging, dashboard API*
- *`03_ARCHITECT_IMPLEMENTATION.md` → Purpose, actions, dependencies, risks, testing*
