# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend | Java Agent
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

Usage tracking and billing infrastructure exists but is disconnected from actual AI calls:
- Java agent makes AI calls but never reports token counts back
- Backend `UsageLogger.log()` is only called from tests
- `BillingService.aggregateDailyBilling()` is never scheduled
- `project_billing` table is empty
- Pricing endpoints return hardcoded stubs

---

## Current State

### Backend
- `UsageLogger.log(projectId, userId, agentId, providerType, model, usage, durationMs, ticketId)` — inserts into `usage_logs`
- `BillingService.aggregateDailyBilling()` — groups `usage_logs` by project/day, writes to `project_billing`
- `BillingService.getUsageSince(projectId, since)` — groups by `provider_type, model`
- Backend providers (`ClaudeProvider`, `OpenAIProvider`, `GenericProvider`) — `chat()` returns `{ content, usage }` but nothing consumes `usage`
- `pricing.js` — `MODEL_PRICING` map exists, but `/api/pricing/*` endpoints return hardcoded stubs
- `usage_logs.agent_id` — FK references `users(id)`, should reference `agents(id)`

### Java Agent
- `ClaudeProvider.generateResponse()` — receives response with `usage.input_tokens`, `usage.output_tokens`
- `OpenAiProvider.generateResponse()` — receives response with `usage.prompt_tokens`, `usage.completion_tokens`
- `OpenAiCompatibleProvider.generateResponse()` — receives response with `usage.prompt_tokens`, `usage.completion_tokens`
- `TicketProcessor.generateContent()` — calls `aiProvider.generateResponse()`, gets text, **never reports usage**
- No endpoint on backend for agents to report usage

---

## Design

### 1. Database Migration — Fix `agent_id` FK

```sql
-- usage_logs.agent_id currently references users(id)
-- Fix to reference agents(id)
ALTER TABLE usage_logs DROP CONSTRAINT IF EXISTS usage_logs_agent_id_fkey;
ALTER TABLE usage_logs ADD CONSTRAINT usage_logs_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL;
```

Note: Since there's no data, this is safe. The `agents` table has its own `id` column (BIGSERIAL) separate from `users.id`.

### 2. Backend — Usage Reporting Endpoint

```
POST /api/v1/agents/:agentId/usage
Auth: X-API-Key header
Body: {
  "provider_type": "claude",
  "model": "claude-sonnet-4-20250514",
  "tokens_in": 1500,
  "tokens_out": 500,
  "duration_ms": 3200,
  "ticket_id": 42,
  "project_id": 1
}
```

Handler calls `UsageLogger.log()` with the provided data. Cost is calculated server-side using `calculateCost(model, tokensIn, tokensOut)`.

### 3. Backend — Provider Usage Logging

Each backend provider's `chat()` method should log usage:

```js
// In providers/claude/index.js
async chat(messages, options) {
  const startTime = Date.now();
  const response = await this.client.messages.create(params);
  
  const usage = {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  };
  
  // Log usage
  await UsageLogger.log(
    this.projectId, this.userId, this.agentId,
    'claude', this.model,
    usage,
    Date.now() - startTime,
    this.ticketId
  );
  
  return { content: response.content[0].text, usage };
}
```

Same pattern for `openai/index.js` and `generic/index.js`.

### 4. Backend — Billing Aggregation Trigger

```
POST /api/v1/billing/aggregate
Auth: requires project_admin or super_admin
Body: { date: '2026-07-12' }  // optional, defaults to yesterday
```

Handler calls `BillingService.aggregateDailyBilling(date)`.

For production, add optional scheduled task in `index.js`:
```js
// Run daily at midnight
const dailyAgg = setInterval(async () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  await BillingService.aggregateDailyBilling(yesterday);
}, 24 * 60 * 60 * 1000);
```

### 5. Backend — Real Pricing Data

Replace hardcoded stubs in `pricing.js` with real data from `MODEL_PRICING`:

```js
// Before (stub):
res.json({ success: true, data: { free: { ... }, pro: { ... } } });

// After (real):
res.json({ success: true, data: MODEL_PRICING });
```

### 6. Java Agent — Usage Reporting

New method in `ApiService.java`:
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
    
    executePost(url, body);
}
```

Called from `TicketProcessor.generateContent()`:
```java
private String generateContent(Ticket ticket, List<String> planningDocs) throws IOException {
    long startTime = System.currentTimeMillis();
    String response = aiProvider.generateResponse(systemPrompt, userMessage);
    long durationMs = System.currentTimeMillis() - startTime;
    
    // Report usage
    try {
        int tokensIn = aiProvider.getTokensIn();
        int tokensOut = aiProvider.getTokensOut();
        apiService.reportUsage(
            config.getAgentId(),
            aiProvider.getType(),
            config.getAiModel(),
            tokensIn, tokensOut, durationMs,
            ticket.getId()
        );
    } catch (Exception e) {
        log.warn("Failed to report usage: {}", e.getMessage());
    }
    
    return response;
}
```

Each Java `AiProvider` needs methods to expose token counts:
```java
// In ClaudeProvider, OpenAiProvider, OpenAiCompatibleProvider
public int getTokensIn() { return this.tokensIn; }
public int getTokensOut() { return this.tokensOut; }
// Set tokensIn/tokensOut after parsing response
```

---

## Data Flow Diagram

```
[Java Agent] → [AI Provider API call] → [OpenAI/Anthropic]
    ↓                              ↓
[Parse tokens]              [Response with usage]
    ↓
[TicketProcessor.reportUsage()]
    → POST /api/v1/agents/:agentId/usage
    → X-API-Key: AGENT_API_KEY
    ↓
[Backend: UsageLogger.log()]
    → INSERT INTO usage_logs
    ↓
[BillingService.aggregateDailyBilling()]
    → SELECT FROM usage_logs GROUP BY project_id, date
    → UPSERT INTO project_billing
```

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/migrations/033_fix_usage_logs_fk.sql` | CREATE | Fix agent_id FK, add indexes |
| `backend/src/migrations/033_fix_usage_logs_fk_rollback.sql` | CREATE | Rollback |
| `backend/src/migrations/apply.js` | MODIFY | Add 033 |
| `backend/src/api/usage.js` | MODIFY | Add `POST /agents/:agentId/usage` endpoint |
| `backend/src/api/billing.js` | MODIFY | Add `POST /aggregate` endpoint |
| `backend/src/services/UsageLogger.js` | MODIFY | Add `reportUsage()` static method |
| `backend/src/services/BillingService.js` | MODIFY | Make `aggregateDailyBilling()` public, add date parameter |
| `backend/src/api/pricing.js` | MODIFY | Return real `MODEL_PRICING` data |
| `backend/src/providers/claude/index.js` | MODIFY | Log usage after chat() |
| `backend/src/providers/openai/index.js` | MODIFY | Log usage after chat() |
| `backend/src/providers/generic/index.js` | MODIFY | Log usage after chat() |
| `agent/src/main/java/.../service/ApiService.java` | MODIFY | Add reportUsage() |
| `agent/src/main/java/.../service/TicketProcessor.java` | MODIFY | Report usage after AI call |
| `agent/src/main/java/.../service/AiProvider.java` | MODIFY | Add getTokensIn/getTokensOut |
| `agent/src/main/java/.../ClaudeProvider.java` | MODIFY | Track tokens, expose getters |
| `agent/src/main/java/.../OpenAiProvider.java` | MODIFY | Track tokens, expose getters |
| `agent/src/main/java/.../OpenAiCompatibleProvider.java` | MODIFY | Track tokens, expose getters |

---

## Security Considerations

- [x] Usage reporting requires valid X-API-Key
- [x] Agent can only report its own usage (agentId in URL)
- [x] Cost calculated server-side, not client-provided
- [x] No PII in usage reports

---

## Risks and Edge Cases

- **[Agent reports wrong tokens]**: Agent sends incorrect token counts. **Mitigation**: Server calculates cost from model name (standard pricing), agent sends raw tokens for transparency.
- **[Backend down during usage report]**: Agent logs warning, continues. Usage data is lost for that call. Acceptable trade-off.
- **[Double counting]**: Both Java agent and backend provider log the same call. **Mitigation**: Java agent usage is the primary source. Backend provider logging is for non-agent AI calls (if any).

---

## Alternative Designs Considered

### Alternative 1: Backend calculates cost, agent sends raw tokens

Agent sends `tokens_in`, `tokens_out`. Backend calculates cost using `MODEL_PRICING`.

- **Pros**: Single source of truth for pricing, agent doesn't need pricing knowledge
- **Cons**: Agent can't estimate costs locally
- **Decision**: This approach. Backend is the source of truth for pricing.

### Alternative 2: Batch usage reporting

Agent batches usage reports and sends every N calls.

- **Pros**: Fewer HTTP requests, more resilient
- **Cons**: More complex, risk of data loss on crash
- **Decision**: Not chosen. Synchronous reporting is simpler and accurate enough.

---

*This design document guides implementation.*
