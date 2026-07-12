# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Template

**Status**: planned
**Priority**: P2
**Effort**: Large
**Author**: AI Assistant
**Date created**: 2026-07-12
**Date completed**: {{YYYY-MM-DD}}
**PR**: {{link}}
**Branch**: {{branch-name}}
**Scope**: Backend | Java Agent

**Dependencies**: bp-01 (providers table), bp-02 (agent provider resolution recommended but not required)

---

### a) Purpose

Connect the existing but disconnected usage tracking and billing infrastructure to actual AI calls. Java agents report token usage after each AI call. Backend provider `chat()` methods log usage. Billing aggregates usage into project-level cost reports.

---

### b) Actions

**Implementation Order:**

1. **Database migration** — `backend/src/migrations/033_fix_usage_logs_fk.sql`
   - Fix `agent_id` FK to reference `agents(id)`
   - Add indexes
   - *Depends on*: nothing

2. **Update migration apply order** — `backend/src/migrations/apply.js`
   - Add 033
   - *Depends on*: Step 1

3. **Backend: UsageLogger** — `backend/src/services/UsageLogger.js`
   - Add `reportUsage(agentId, data)` method for agent reporting
   - Validate and sanitize input
   - *Depends on*: Step 1

4. **Backend: BillingService** — `backend/src/services/BillingService.js`
   - Make `aggregateDailyBilling(date)` public with date parameter
   - *Depends on*: nothing

5. **Backend: Usage routes** — `backend/src/api/usage.js`
   - Add `POST /agents/:agentId/usage` endpoint
   - Add validation for usage report body
   - *Depends on*: Step 3

6. **Backend: Billing routes** — `backend/src/api/billing.js`
   - Add `POST /aggregate` endpoint
   - *Depends on*: Step 4

7. **Backend: Pricing routes** — `backend/src/api/pricing.js`
   - Replace hardcoded stubs with real `MODEL_PRICING` data
   - *Depends on*: nothing

8. **Backend: Provider usage logging** — `backend/src/providers/*/index.js`
   - Log usage after each `chat()` call in claude, openai, generic providers
   - *Depends on*: Step 3

9. **Java Agent: AiProvider interface** — `agent/.../service/AiProvider.java`
   - Add `getTokensIn()`, `getTokensOut()` methods
   - *Depends on*: nothing

10. **Java Agent: Provider implementations** — `agent/.../ClaudeProvider.java`, `OpenAiProvider.java`, `OpenAiCompatibleProvider.java`
    - Track `tokensIn`, `tokensOut` after parsing response
    - Implement getter methods
    - *Depends on*: Step 9

11. **Java Agent: ApiService** — `agent/.../service/ApiService.java`
    - Add `reportUsage()` method
    - *Depends on*: Step 5

12. **Java Agent: TicketProcessor** — `agent/.../service/TicketProcessor.java`
    - Report usage after each AI call
    - *Depends on*: Steps 10, 11

13. **Tests** — Backend unit + integration tests
    - *Depends on*: Steps 3-8

---

### c) Per-File Action Plan

#### `backend/src/migrations/033_fix_usage_logs_fk.sql` (CREATE)

```sql
-- Fix agent_id FK: currently references users(id), should reference agents(id)
ALTER TABLE usage_logs DROP CONSTRAINT IF EXISTS usage_logs_agent_id_fkey;
ALTER TABLE usage_logs ADD CONSTRAINT usage_logs_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL;

-- Ensure indexes exist
CREATE INDEX IF NOT EXISTS idx_usage_logs_agent_id ON usage_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_provider_type ON usage_logs(provider_type);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON usage_logs(created_at);
```

#### `backend/src/migrations/apply.js` (MODIFY)

Add `'033_fix_usage_logs_fk.sql'` after 032 entries.

#### `backend/src/services/UsageLogger.js` (MODIFY)

Add method:
```js
static async reportUsage(agentId, data) {
  const { provider_type, model, tokens_in, tokens_out, duration_ms, ticket_id, project_id } = data;
  
  // Validate required fields
  if (!provider_type || !model || tokens_in == null || tokens_out == null) {
    throw new AppError('Missing required fields: provider_type, model, tokens_in, tokens_out', 400);
  }
  
  // Calculate cost server-side
  const cost = calculateCost(model, tokens_in, tokens_out);
  
  await pool.query(`
    INSERT INTO usage_logs
      (agent_id, provider_type, model, tokens_in, tokens_out, cost_usd, duration_ms, ticket_id, project_id, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
  `, [agentId, provider_type, model, tokens_in, tokens_out, cost, duration_ms || 0, ticket_id || null, project_id || null]);
}
```

#### `backend/src/services/BillingService.js` (MODIFY)

Make aggregateDailyBilling public with date parameter:
```js
static async aggregateDailyBilling(date = new Date()) {
  // Use provided date or default to yesterday
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const startOfNext = new Date(startOfDay);
  startOfNext.setDate(startOfNext.getDate() + 1);
  
  const result = await pool.query(`
    SELECT project_id,
           SUM(cost_usd) as total_cost,
           SUM(tokens_in) as total_in,
           SUM(tokens_out) as total_out,
           COUNT(*) as total_calls
    FROM usage_logs
    WHERE created_at >= $1 AND created_at < $2
    GROUP BY project_id
  `, [startOfDay, startOfNext]);
  
  for (const row of result.rows) {
    await pool.query(`
      INSERT INTO project_billing
        (project_id, billing_month, total_cost_usd, total_tokens_in, total_tokens_out, total_calls)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (project_id, billing_month)
      DO UPDATE SET
        total_cost_usd = EXCLUDED.total_cost_usd,
        total_tokens_in = EXCLUDED.total_tokens_in,
        total_tokens_out = EXCLUDED.total_tokens_out,
        total_calls = EXCLUDED.total_calls
    `, [row.project_id, startOfDay.toISOString().split('T')[0], row.total_cost, row.total_in, row.total_out, row.total_calls]);
  }
  
  return result.rows.length;
}
```

#### `backend/src/api/usage.js` (MODIFY)

Add agent usage endpoint:
```js
// Report usage from Java agent
router.post('/agents/:agentId/usage', verifyToken, async (req, res, next) => {
  try {
    const agentId = parseInt(req.params.agentId);
    const usage = req.body;
    
    // Validate
    if (!usage.provider_type || !usage.model || usage.tokens_in == null || usage.tokens_out == null) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Missing required fields' } });
    }
    
    await UsageLogger.reportUsage(agentId, usage);
    res.json({ success: true, data: { recorded: true } });
  } catch (err) {
    next(err);
  }
});
```

#### `backend/src/api/billing.js` (MODIFY)

Add aggregate endpoint:
```js
// Trigger daily billing aggregation
router.post('/aggregate', verifyToken, requireAnyPermission('PROJECT_ADMIN', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { date } = req.body;
    const aggDate = date ? new Date(date) : new Date(Date.now() - 86400000); // yesterday
    const count = await BillingService.aggregateDailyBilling(aggDate);
    res.json({ success: true, data: { aggregatedDays: count, date: aggDate.toISOString().split('T')[0] } });
  } catch (err) {
    next(err);
  }
});
```

#### `backend/src/api/pricing.js` (MODIFY)

Replace stubs with real data:
```js
// Before: hardcoded stubs
// After:
const { MODEL_PRICING, getModelPricing, getAllModels } = require('../utils/pricing');

router.get('/tiers', (req, res) => {
  // Return actual pricing model data
  res.json({ success: true, data: MODEL_PRICING });
});

router.get('/models', (req, res) => {
  res.json({ success: true, data: { models: getAllModels() } });
});
```

#### `backend/src/providers/claude/index.js` (MODIFY)

Log usage after chat:
```js
async chat(messages, options = {}) {
  const startTime = Date.now();
  const response = await this.client.messages.create(params);
  const duration = Date.now() - startTime;
  
  const usage = {
    input_tokens: response.usage?.input_tokens || 0,
    output_tokens: response.usage?.output_tokens || 0,
  };
  
  // Log usage
  try {
    await UsageLogger.log(
      this.projectId, this.userId, this.agentId,
      'claude', this.model, usage, duration, this.ticketId
    );
  } catch (e) {
    console.error('Failed to log usage:', e.message);
  }
  
  return { content: response.content[0].text, usage };
}
```

Same pattern for `openai/index.js` and `generic/index.js`.

#### `agent/src/main/java/.../service/AiProvider.java` (MODIFY)

Add methods:
```java
public interface AiProvider {
    String generateResponse(String systemPrompt, String userMessage) throws IOException;
    String getType();
    int getTokensIn();   // NEW
    int getTokensOut();  // NEW
}
```

#### `agent/src/main/java/.../service/ClaudeProvider.java` (MODIFY)

Track tokens:
```java
private int tokensIn = 0;
private int tokensOut = 0;

// After parsing response:
this.tokensIn = jsonNode.path("usage").path("input_tokens").asInt(0);
this.tokensOut = jsonNode.path("usage").path("output_tokens").asInt(0);

@Override
public int getTokensIn() { return tokensIn; }
@Override
public int getTokensOut() { return tokensOut; }
```

Same pattern for `OpenAiProvider.java` and `OpenAiCompatibleProvider.java` (parse `prompt_tokens`/`completion_tokens`).

#### `agent/src/main/java/.../service/ApiService.java` (MODIFY)

Add method:
```java
public void reportUsage(String agentId, String providerType, String model,
                        int tokensIn, int tokensOut, long durationMs, Long ticketId) throws IOException {
    String url = baseUrl + "/api/v1/agents/" + agentId + "/usage";
    
    Map<String, Object> body = new HashMap<>();
    body.put("provider_type", providerType);
    body.put("model", model);
    body.put("tokens_in", tokensIn);
    body.put("tokens_out", tokensOut);
    body.put("duration_ms", durationMs);
    if (ticketId != null) body.put("ticket_id", ticketId);
    
    // Execute POST with X-API-Key header
    // No return value needed
}
```

#### `agent/src/main/java/.../service/TicketProcessor.java` (MODIFY)

Report usage after AI call:
```java
private String generateContent(Ticket ticket, List<String> planningDocs) throws IOException {
    long startTime = System.currentTimeMillis();
    String generatedContent = aiProvider.generateResponse(systemPrompt, userMessage);
    long durationMs = System.currentTimeMillis() - startTime;
    
    // Report usage to backend
    try {
        apiService.reportUsage(
            config.getAgentId(),
            aiProvider.getType(),
            config.getAiModel(),
            aiProvider.getTokensIn(),
            aiProvider.getTokensOut(),
            durationMs,
            ticket.getId()
        );
    } catch (Exception e) {
        log.warn("Failed to report usage for ticket {}: {}", ticket.getId(), e.getMessage());
    }
    
    return generatedContent;
}
```

---

### d) Dependencies

- [Backend service]: `UsageLogger.reportUsage()` — stores agent-reported usage
- [Backend service]: `BillingService.aggregateDailyBilling()` — aggregates to project_billing
- [Backend route]: `POST /agents/:agentId/usage` — agent reporting endpoint
- [Backend route]: `POST /billing/aggregate` — manual aggregation trigger
- [Java agent]: `AiProvider.getTokensIn/getTokensOut` — expose token counts
- [Java agent]: `TicketProcessor` — report usage after each AI call

---

### e) Risks/Edge Cases

- **[Agent reports after failed call]**: Token counts may be partial. **Mitigation**: Only report on successful responses.
- **[Double logging]**: Both Java agent and backend provider log the same call. **Mitigation**: Java agent is the primary source. Backend provider logging is for non-agent calls.
- **[Cost calculation mismatch]**: Agent and backend might use different pricing. **Mitigation**: Backend is source of truth — it recalculates cost from model name.

---

### f) Testing

#### Backend Unit Tests
- [ ] `UsageLogger.reportUsage()` inserts correct row with calculated cost
- [ ] `UsageLogger.reportUsage()` validates required fields
- [ ] `BillingService.aggregateDailyBilling()` groups and writes correctly
- [ ] `POST /agents/:agentId/usage` stores usage, returns 200
- [ ] `POST /agents/:agentId/usage` returns 400 for missing fields
- [ ] `POST /agents/:agentId/usage` returns 401 without auth
- [ ] `POST /billing/aggregate` triggers aggregation
- [ ] `GET /pricing/tiers` returns real MODEL_PRICING data
- [ ] Provider `chat()` methods call UsageLogger

#### Backend Integration Tests
- [ ] Full flow: agent reports usage → usage_logs populated → aggregate → project_billing populated

---

### g) Migration Notes

Migration: `backend/src/migrations/033_fix_usage_logs_fk.sql`
- Fixes `agent_id` FK from `users(id)` to `agents(id)`
- Adds indexes on `agent_id`, `provider_type`, `created_at`

Rollback: `backend/src/migrations/033_fix_usage_logs_fk_rollback.sql`
- Reverts FK to `users(id)`
- Drops added indexes

---

### h) Files Changed

**Backend:**
```
backend/src/migrations/033_fix_usage_logs_fk.sql              → CREATE
backend/src/migrations/033_fix_usage_logs_fk_rollback.sql     → CREATE
backend/src/migrations/apply.js                               → MODIFY
backend/src/services/UsageLogger.js                           → MODIFY
backend/src/services/BillingService.js                        → MODIFY
backend/src/api/usage.js                                      → MODIFY
backend/src/api/billing.js                                    → MODIFY
backend/src/api/pricing.js                                    → MODIFY
backend/src/providers/claude/index.js                         → MODIFY
backend/src/providers/openai/index.js                         → MODIFY
backend/src/providers/generic/index.js                        → MODIFY
```

**Java Agent:**
```
agent/.../service/AiProvider.java       → MODIFY (add getters)
agent/.../ClaudeProvider.java           → MODIFY (track tokens)
agent/.../OpenAiProvider.java           → MODIFY (track tokens)
agent/.../OpenAiCompatibleProvider.java → MODIFY (track tokens)
agent/.../service/ApiService.java       → MODIFY (add reportUsage)
agent/.../service/TicketProcessor.java  → MODIFY (report after AI call)
```

**Tests:**
```
backend/src/__tests__/usageLogger.test.js     → EXTEND
backend/src/__tests__/billingService.test.js  → EXTEND
backend/src/__tests__/api-usage.test.js       → CREATE
backend/src/__tests__/api-billing.test.js     → EXTEND
```

---

### i) Code Review Checklist

- [ ] Backend: Usage logged server-side, cost calculated from MODEL_PRICING
- [ ] Backend: Agent can only report its own usage
- [ ] Backend: Pricing endpoints return real data
- [ ] Java: Token counts parsed from actual API responses
- [ ] Java: Usage reporting failure doesn't break ticket processing
- [ ] Migration: FK change is safe (no existing data)

---

### j) Post-Deploy Verification

1. [ ] Backend: `npm test` passes
2. [ ] Backend: `npm run lint` passes
3. [ ] Java agent: `mvn clean package` compiles
4. [ ] Agent reports usage after AI call
5. [ ] `usage_logs` table populated with real data
6. [ ] `POST /api/v1/billing/aggregate` populates `project_billing`
7. [ ] `GET /api/usage/projects/:id/usage` returns provider breakdown
8. [ ] `GET /api/pricing/tiers` returns real pricing data

---

*Fill in all sections before starting implementation.*
