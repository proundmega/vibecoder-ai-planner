# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: draft
**Author**: AI Assistant
**Scope**: Backend | Java Agent | Frontend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `00_ARCHITECT_CHECKLIST.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

bp-04 connected usage tracking to agent AI calls, but all usage is attributed at the **ticket level** only. When a customer asks "how much did it cost to process the requirement extraction stage vs. plan generation vs. code generation?", the system cannot answer. The feedback from PR #66 explicitly requests attaching usage to the **planning object itself** across stages: requirement extraction, plan generation, refinement, and validation.

---

## Current State

### Backend
- `usage_logs` table: `ticket_id`, `agent_id`, `provider_type`, `model`, `tokens_in`, `tokens_out`, `cost_usd`, `duration_ms` — no `planning_stage` or `file_key`
- `ticket_planning` table: `ticket_id`, `file_key`, `content`, `version` — no usage columns
- `UsageLogger.log()`: accepts `projectId, userId, agentId, providerType, model, usage, durationMs, ticketId` — no planning context
- `POST /api/v1/agents/:agentId/usage`: agent reports usage, stored in `usage_logs`
- `GET /usage/projects/:id/usage`: returns project-level breakdown by provider/model
- `TicketPlanningService`: CRUD for planning files, no usage integration

### Java Agent
- `TicketProcessor.generateContent()`: calls AI, reports usage with `ticket_id` only
- `ApiService.reportUsage()`: POSTs `{provider_type, model, tokens_in, tokens_out, duration_ms, ticket_id}`
- Agent fetches ALL planning docs before making AI call — no per-file attribution

### Frontend
- Planning viewer displays file content + version info
- No usage/cost indicators anywhere in the UI

---

## Design

### 1. Database Changes — Two Migrations

#### Migration 038a: Add usage columns to `ticket_planning`

```sql
-- Attach last-known usage to each planning file (the "planning object itself")
ALTER TABLE ticket_planning
  ADD COLUMN IF NOT EXISTS last_tokens_in INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_tokens_out INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_cost_usd NUMERIC(12,6) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_duration_ms INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_provider_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS last_model VARCHAR(100),
  ADD COLUMN IF NOT EXISTS last_planning_stage VARCHAR(50),
  ADD COLUMN IF NOT EXISTS last_ai_call_at TIMESTAMP;

-- Index for querying planning files with usage data
CREATE INDEX IF NOT EXISTS idx_ticket_planning_last_ai_call
  ON ticket_planning(ticket_id, last_ai_call_at DESC);
```

#### Migration 038b: Add planning context to `usage_logs`

```sql
-- Track which planning stage and file each usage entry belongs to
ALTER TABLE usage_logs
  ADD COLUMN IF NOT EXISTS planning_stage VARCHAR(50),
  ADD COLUMN IF NOT EXISTS file_key VARCHAR(100);

-- Index for per-file usage queries
CREATE INDEX IF NOT EXISTS idx_usage_logs_planning_stage
  ON usage_logs(ticket_id, planning_stage);
CREATE INDEX IF NOT EXISTS idx_usage_logs_file_key
  ON usage_logs(ticket_id, file_key);
```

### 2. Planning Stages Enum

Controlled set of planning stages:

```js
const PLANNING_STAGES = Object.freeze({
  REQUIREMENT_EXTRACTION: 'requirement_extraction',
  PLAN_GENERATION: 'plan_generation',
  REFINEMENT: 'refinement',
  VALIDATION: 'validation',
});
```

### 3. Backend — UsageLogger Extensions

#### Extend `log()` with optional planning context

```js
static async log(projectId, userId, agentId, providerType, model, usage, durationMs, ticketId, options = {}) {
  const { planningStage, fileKey } = options;
  
  const cost = calculateCost(model, usage.input_tokens || usage.tokens_in || 0, 
                                    usage.output_tokens || usage.tokens_out || 0);
  
  await pool.query(`
    INSERT INTO usage_logs
      (project_id, user_id, agent_id, provider_type, model, 
       tokens_in, tokens_out, cost_usd, duration_ms, ticket_id,
       planning_stage, file_key)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  `, [projectId, userId, agentId, providerType, model,
      usage.input_tokens || usage.tokens_in || 0,
      usage.output_tokens || usage.tokens_out || 0,
      cost, durationMs, ticketId || null,
      planningStage || null, fileKey || null]);
  
  // Update last-known usage on ticket_planning if fileKey is provided
  if (fileKey && ticketId) {
    await pool.query(`
      UPDATE ticket_planning
      SET last_tokens_in = $1, last_tokens_out = $2, last_cost_usd = $3,
          last_duration_ms = $4, last_provider_type = $5, last_model = $6,
          last_planning_stage = $7, last_ai_call_at = NOW()
      WHERE ticket_id = $8 AND file_key = $9
    `, [usage.input_tokens || usage.tokens_in || 0,
        usage.output_tokens || usage.tokens_out || 0,
        cost, durationMs, providerType, model,
        planningStage || null, ticketId, fileKey]);
  }
}
```

#### New method: `logPlanningUsage()`

For explicit planning-stage usage logging (when called from non-ticket-processor paths):

```js
static async logPlanningUsage(projectId, userId, agentId, planData) {
  const {
    ticketId,
    planningStage,
    fileKeys,        // array of file_keys this stage touched
    providerType,
    model,
    tokensIn,
    tokensOut,
    durationMs,
  } = planData;
  
  const cost = calculateCost(model, tokensIn, tokensOut);
  
  // Log one entry per file_key (so each file gets its own usage record)
  for (const fk of (fileKeys || [])) {
    await pool.query(`
      INSERT INTO usage_logs
        (project_id, user_id, agent_id, provider_type, model,
         tokens_in, tokens_out, cost_usd, duration_ms, ticket_id,
         planning_stage, file_key)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [projectId, userId, agentId, providerType, model,
        tokensIn, tokensOut, cost, durationMs, ticketId,
        planningStage, fk]);
    
    // Update last-known on ticket_planning
    await pool.query(`
      UPDATE ticket_planning
      SET last_tokens_in = $1, last_tokens_out = $2, last_cost_usd = $3,
          last_duration_ms = $4, last_provider_type = $5, last_model = $6,
          last_planning_stage = $7, last_ai_call_at = NOW()
      WHERE ticket_id = $8 AND file_key = $9
    `, [tokensIn, tokensOut, cost, durationMs, providerType, model,
        planningStage, ticketId, fk]);
  }
  
  // If no file_keys specified, log at ticket level only
  if (!fileKeys || fileKeys.length === 0) {
    await pool.query(`
      INSERT INTO usage_logs
        (project_id, user_id, agent_id, provider_type, model,
         tokens_in, tokens_out, cost_usd, duration_ms, ticket_id,
         planning_stage)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [projectId, userId, agentId, providerType, model,
        tokensIn, tokensOut, cost, durationMs, ticketId,
        planningStage]);
  }
}
```

### 4. Backend — New API Endpoints

#### `GET /tickets/:ticketId/planning/usage` — Aggregated per-stage usage

```
GET /api/v1/tickets/:ticketId/planning/usage
Auth: verifyToken + permission (VIEW_TICKET or higher)

Response:
{
  "success": true,
  "data": {
    "ticketId": 42,
    "totalCost": 0.045,
    "totalTokensIn": 12500,
    "totalTokensOut": 3200,
    "totalDurationMs": 28000,
    "byStage": {
      "requirement_extraction": {
        "tokensIn": 5000, "tokensOut": 800, "costUsd": 0.015,
        "durationMs": 8000, "callCount": 2
      },
      "plan_generation": {
        "tokensIn": 4500, "tokensOut": 1500, "costUsd": 0.018,
        "durationMs": 12000, "callCount": 1
      },
      "refinement": {
        "tokensIn": 2000, "tokensOut": 600, "costUsd": 0.007,
        "durationMs": 5000, "callCount": 1
      },
      "validation": {
        "tokensIn": 1000, "tokensOut": 300, "costUsd": 0.005,
        "durationMs": 3000, "callCount": 1
      }
    },
    "byFile": [
      { "fileKey": "01_ARCHITECT_REQUIREMENT.md", "tokensIn": 5000, "tokensOut": 800, "costUsd": 0.015 },
      { "fileKey": "02_ARCHITECT_DESIGN.md", "tokensIn": 4500, "tokensOut": 1500, "costUsd": 0.018 }
    ]
  }
}
```

#### `GET /tickets/:ticketId/planning/:fileKey/usage` — Per-file usage history

```
GET /api/v1/tickets/:ticketId/planning/:fileKey/usage
Auth: verifyToken + permission (VIEW_TICKET or higher)

Response:
{
  "success": true,
  "data": {
    "fileKey": "01_ARCHITECT_REQUIREMENT.md",
    "lastUsage": {
      "tokensIn": 5000, "tokensOut": 800, "costUsd": 0.015,
      "durationMs": 8000, "providerType": "claude", "model": "claude-sonnet-4-20250514",
      "planningStage": "requirement_extraction", "at": "2026-07-23T10:30:00Z"
    },
    "history": [
      {
        "tokensIn": 4000, "tokensOut": 600, "costUsd": 0.012,
        "durationMs": 7000, "planningStage": "requirement_extraction",
        "at": "2026-07-22T14:00:00Z"
      },
      {
        "tokensIn": 5000, "tokensOut": 800, "costUsd": 0.015,
        "durationMs": 8000, "planningStage": "requirement_extraction",
        "at": "2026-07-23T10:30:00Z"
      }
    ]
  }
}
```

### 5. Backend — TicketPlanningService Extensions

#### Extend `list()` to include usage metadata

```js
async list(ticketId, userId) {
  const result = await pool.query(
    `SELECT tp.*, u.name as created_by_name, t.title as ticket_title,
            tp.last_tokens_in, tp.last_tokens_out, tp.last_cost_usd,
            tp.last_duration_ms, tp.last_provider_type, tp.last_model,
            tp.last_planning_stage, tp.last_ai_call_at
     FROM ticket_planning tp
     LEFT JOIN users u ON tp.created_by = u.id
     JOIN tickets t ON tp.ticket_id = t.id
     WHERE tp.ticket_id = $1
     ORDER BY tp.file_key ASC, tp.version DESC`,
    [ticketId]
  );
  // ... same dedup logic, but include usage fields in response
}
```

#### Extend `get()` to include usage metadata

Same pattern — include `last_*` usage columns in the response.

### 6. Java Agent — Usage Reporting with Planning Context

#### Extend `ApiService.reportUsage()`

```java
public void reportUsage(String agentId, String providerType, String model,
                        int tokensIn, int tokensOut, long durationMs, Long ticketId,
                        String planningStage, List<String> fileKeys) throws IOException {
    String url = baseUrl + "/usage/agents/" + agentId + "/usage";
    
    Map<String, Object> body = new HashMap<>();
    body.put("provider_type", providerType);
    body.put("model", model);
    body.put("tokens_in", tokensIn);
    body.put("tokens_out", tokensOut);
    body.put("duration_ms", durationMs);
    body.put("ticket_id", ticketId);
    if (planningStage != null) body.put("planning_stage", planningStage);
    if (fileKeys != null && !fileKeys.isEmpty()) body.put("file_keys", fileKeys);
    
    executePost(url, body);
}
```

#### Extend `TicketProcessor.generateContent()`

```java
private String generateContent(Ticket ticket, List<String> planningDocs) throws IOException {
    // Determine which planning stage we're in based on which docs were fetched
    String planningStage = inferPlanningStage(planningDocs);
    List<String> fileKeys = extractFileKeys(planningDocs);
    
    long startTime = System.currentTimeMillis();
    String generatedContent = aiProvider.generateResponse(systemPrompt, userMessage);
    long durationMs = System.currentTimeMillis() - startTime;
    
    try {
        apiService.reportUsage(
            config.getAgentId(),
            aiProvider.getType(),
            config.getAiModel(),
            aiProvider.getTokensIn(),
            aiProvider.getTokensOut(),
            durationMs,
            ticket.getId(),
            planningStage,
            fileKeys
        );
    } catch (Exception e) {
        log.warn("Failed to report usage for ticket {}: {}", ticket.getId(), e.getMessage());
    }
    
    return generatedContent;
}

private String inferPlanningStage(List<String> planningDocs) {
    // Heuristic: if docs include 01_ARCHITECT_REQUIREMENT.md → requirement_extraction
    // if docs include 02_ARCHITECT_DESIGN.md → plan_generation
    // etc.
    boolean hasRequirement = planningDocs.stream().anyMatch(d -> d.contains("01_ARCHITECT_REQUIREMENT"));
    boolean hasDesign = planningDocs.stream().anyMatch(d -> d.contains("02_ARCHITECT_DESIGN"));
    boolean hasImplementation = planningDocs.stream().anyMatch(d -> d.contains("03_ARCHITECT_IMPLEMENTATION"));
    
    if (hasImplementation) return "validation";
    if (hasDesign) return "plan_generation";
    if (hasRequirement) return "requirement_extraction";
    return "requirement_extraction"; // default
}

private List<String> extractFileKeys(List<String> planningDocs) {
    List<String> keys = new ArrayList<>();
    for (String doc : planningDocs) {
        if (doc.startsWith("=== ")) {
            keys.add(doc.substring(4, doc.indexOf(" ===")));
        }
    }
    return keys;
}
```

### 7. Backend — Agent Usage Endpoint Extension

The existing `POST /api/v1/agents/:agentId/usage` endpoint needs to accept and store the new fields:

```js
router.post('/agents/:agentId/usage', verifyToken, async (req, res, next) => {
  try {
    const agentId = parseInt(req.params.agentId);
    const { provider_type, model, tokens_in, tokens_out, duration_ms, ticket_id,
            planning_stage, file_keys } = req.body;
    
    const cost = calculateCost(model, tokens_in, tokens_out);
    
    // Insert into usage_logs with planning context
    await pool.query(`
      INSERT INTO usage_logs
        (agent_id, provider_type, model, tokens_in, tokens_out, cost_usd, 
         duration_ms, ticket_id, planning_stage, file_key)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [agentId, provider_type, model, tokens_in, tokens_out, cost,
        duration_ms || 0, ticket_id || null, planning_stage || null,
        file_keys && file_keys.length > 0 ? file_keys[0] : null]);
    
    // If multiple file_keys, also log separate entries per file
    if (file_keys && file_keys.length > 1) {
      for (let i = 1; i < file_keys.length; i++) {
        await pool.query(`
          INSERT INTO usage_logs
            (agent_id, provider_type, model, tokens_in, tokens_out, cost_usd,
             duration_ms, ticket_id, planning_stage, file_key)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [agentId, provider_type, model, tokens_in, tokens_out, cost,
            duration_ms || 0, ticket_id || null, planning_stage || null,
            file_keys[i]]);
      }
    }
    
    res.json({ success: true, data: { recorded: true } });
  } catch (err) {
    next(err);
  }
});
```

### 8. Frontend — Usage Display

#### Planning file viewer — inline usage indicators

Each planning file card shows:
```
┌─────────────────────────────────────┐
│ 01_ARCHITECT_REQUIREMENT.md         │
│ v3 · edited 2h ago                  │
│                                     │
│ [usage indicator]                   │
│ ▲ 5,200 tokens · $0.015 · Claude   │
└─────────────────────────────────────┘
```

#### Ticket detail — usage breakdown tab/section

New section in TicketDetail view:
```
┌─ Usage Breakdown ───────────────────┐
│ Stage                    Tokens  Cost│
│ Requirement Extraction   5,200  $0.015│
│ Plan Generation          4,500  $0.018│
│ Refinement               2,000  $0.007│
│ Validation               1,000  $0.005│
│ ─────────────────────────────────   │
│ Total                     12,700 $0.045│
└─────────────────────────────────────┘
```

---

## Data Flow Diagram

```
[Java Agent] → [Fetch planning docs] → [Backend: GET /tickets/:id/planning]
     ↓                                              ↓
[Parse file_keys from docs]              [Return file list with content]
     ↓
[Build system prompt with planning docs]
     ↓
[Call AI provider] → [OpenAI/Anthropic API]
     ↓                              ↓
[Parse tokens from response]       [Response with usage]
     ↓
[TicketProcessor.reportUsage()]
  → planningStage = infer from docs consumed
  → fileKeys = [01_ARCHITECT_*.md, 02_ARCHITECT_*.md, ...]
     ↓
→ POST /api/v1/agents/:agentId/usage
  { tokens_in, tokens_out, planning_stage, file_keys, ... }
     ↓
[Backend: UsageLogger.log()]
  → INSERT INTO usage_logs (with planning_stage, file_key)
  → UPDATE ticket_planning (last_* usage columns)
     ↓
[Frontend: GET /tickets/:id/planning/usage]
  → Returns aggregated byStage + byFile
     ↓
[Frontend: Display usage breakdown in TicketDetail]
```

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/migrations/038_planning_usage_columns.sql` | CREATE | Add usage columns to `ticket_planning` + `usage_logs` |
| `backend/src/migrations/038_planning_usage_columns_rollback.sql` | CREATE | Rollback |
| `backend/src/migrations/apply.js` | MODIFY | Add 038 to SQL_FILES |
| `backend/src/services/UsageLogger.js` | MODIFY | Extend `log()` with planning context; add `logPlanningUsage()` |
| `backend/src/services/TicketPlanningService.js` | MODIFY | Include usage columns in list/get responses |
| `backend/src/api/v1/index.js` | MODIFY | Register new usage endpoints |
| `backend/src/api/ticketPlanning.js` | MODIFY | Add JSDoc for new endpoints |
| `agent/.../service/TicketProcessor.java` | MODIFY | Report usage with planning_stage + file_keys |
| `agent/.../service/ApiService.java` | MODIFY | Extend reportUsage() with planning params |
| `frontend/src/views/TicketDetail.vue` | MODIFY | Add usage breakdown section |
| `frontend/src/views/PlanningViewer.vue` | MODIFY | Show usage indicators on files |
| `frontend/src/api/client.ts` | MODIFY | Add usage API client methods |

---

## Security Considerations

- Usage data is project-scoped — existing `verifyToken` + permission middleware applies
- Cost data should require `member` role or higher (not `user`)
- `planning_stage` values are server-controlled enum — no user input sanitization needed
- `file_key` values are validated against known planning file keys

---

## Risks and Edge Cases

- **[Agent processes ticket with no planning docs]**: `inferPlanningStage()` returns default. Usage logged as `requirement_extraction`. Acceptable.
- **[Multiple file_keys, one usage entry]**: Backend creates separate `usage_logs` entries per file_key, all with same cost (not split). Customer-facing: each file shows full cost of the stage it participated in. Billing: total cost may be counted multiple times across files. **Mitigation**: For billing, aggregate at `planning_stage` level (not per file).
- **[Usage columns updated on every AI call]**: `UPDATE ticket_planning` fires on each usage log. Could be frequent. **Mitigation**: Use `ON CONFLICT DO NOTHING` or batch updates. Actually, `ticket_planning` has unique constraint on `(ticket_id, file_key, version)` but not on `(ticket_id, file_key)` — the update is safe, just a simple row update.
- **[Backward compatibility]**: New columns are nullable/default. Existing `usage_logs` rows have `NULL` for `planning_stage` and `file_key`. Queries should handle NULLs.

---

## Alternative Designs Considered

### Alternative 1: Separate `planning_usage_logs` table instead of extending `usage_logs`

- **Pros**: Clean separation, no changes to existing table
- **Cons**: Duplicates columns, harder to query combined agent + planning usage
- **Decision**: Not chosen. Extending `usage_logs` is simpler and both agent and planning usage belong in the same table.

### Alternative 2: Store usage in `ticket_planning.content` as JSON metadata

- **Pros**: No migration needed, always in sync with content
- **Cons**: Pollutes content field, harder to query/aggregate, breaks versioning semantics
- **Decision**: Not chosen. Dedicated columns are the right approach.

### Alternative 3: JSONB column for usage history on `ticket_planning`

- **Pros**: Flexible schema, no migration for new fields
- **Cons**: Harder to query, no index support, harder to aggregate for billing
- **Decision**: Not chosen. Structured columns with indexes are better for billing queries.

---

## Pending Scope Items to Present to User

| Item | Source | Category | Priority |
|------|--------|----------|----------|
| bp-75: Log file rotation | PENDING.txt | Infrastructure | P3 |
| bp-78: CSP violation reporting dashboard | PENDING.txt | Security | P2 |
| bp-79: Migration dry-run mode | PENDING.txt | Developer experience | P2 |
| bp-80: PgBouncer deployment | PENDING.txt | Infrastructure | P2 |
| bp-81: Agent bug fixes | PENDING.txt | Stability | unspecified |

---

*This design document guides implementation.*
