# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Template

**Status**: draft
**Priority**: P2
**Effort**: Medium
**Author**: AI Assistant
**Date created**: 2026-07-23
**PR**: {{pr-link}}
**Branch**: {{branch-name}}
**Scope**: Backend | Java Agent | Frontend

**Dependencies**: bp-04 (usage/billing foundations must be committed first)

---

### a) Purpose

Attach AI usage tracking to the planning object itself, so each planning file carries its own usage metadata (tokens, cost, duration, provider) and the system can answer "how much did it cost to process each planning stage?" This enables per-stage billing and customer-facing cost explanations.

---

### b) Actions

**Implementation Order:**

1. **Database migration** — `backend/src/migrations/038_planning_usage_columns.sql`
   - Add usage columns to `ticket_planning`
   - Add `planning_stage` and `file_key` to `usage_logs`
   - Add indexes
   - *Depends on*: nothing

2. **Update migration apply order** — `backend/src/migrations/apply.js`
   - Add 038 to SQL_FILES array
   - *Depends on*: Step 1

3. **Backend: UsageLogger extensions** — `backend/src/services/UsageLogger.js`
   - Extend `log()` with optional `planningStage` and `fileKey` params
   - Add `logPlanningUsage()` static method
   - When `fileKey` is provided, update `ticket_planning.last_*` columns
   - *Depends on*: Step 2

4. **Backend: Agent usage endpoint** — `backend/src/api/v1/index.js` + usage route handler
   - Extend `POST /agents/:agentId/usage` to accept `planning_stage` and `file_keys`
   - Create separate `usage_logs` entries per file_key
   - *Depends on*: Step 3

5. **Backend: TicketPlanningService extensions** — `backend/src/services/TicketPlanningService.js`
   - Include `last_*` usage columns in `list()` and `get()` responses
   - *Depends on*: Step 2

6. **Backend: Usage API endpoints** — new routes
   - `GET /tickets/:ticketId/planning/usage` — aggregated per-stage usage
   - `GET /tickets/:ticketId/planning/:fileKey/usage` — per-file usage history
   - *Depends on*: Step 3

7. **Java Agent: ApiService extension** — `agent/.../service/ApiService.java`
   - Extend `reportUsage()` with `planningStage` and `fileKeys` params
   - *Depends on*: Step 4

8. **Java Agent: TicketProcessor extension** — `agent/.../service/TicketProcessor.java`
   - Add `inferPlanningStage()` heuristic
   - Add `extractFileKeys()` from planning docs
   - Report usage with planning context
   - *Depends on*: Steps 7, 3

9. **Frontend: API client** — `frontend/src/api/client.ts`
   - Add `getTicketPlanningUsage(ticketId)` method
   - Add `getPlanningFileUsage(ticketId, fileKey)` method
   - *Depends on*: Step 6

10. **Frontend: Usage display** — planning viewer + ticket detail
    - Show usage indicators on planning files
    - Show usage breakdown by stage on ticket detail
    - *Depends on*: Step 9

11. **Tests** — Backend unit + integration + frontend unit tests
    - *Depends on*: Steps 3-10

---

### c) Per-File Action Plan

#### `backend/src/migrations/038_planning_usage_columns.sql` (CREATE)

```sql
-- Add last-known usage to ticket_planning (the "planning object itself")
ALTER TABLE ticket_planning
  ADD COLUMN IF NOT EXISTS last_tokens_in INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_tokens_out INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_cost_usd NUMERIC(12,6) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_duration_ms INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_provider_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS last_model VARCHAR(100),
  ADD COLUMN IF NOT EXISTS last_planning_stage VARCHAR(50),
  ADD COLUMN IF NOT EXISTS last_ai_call_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_ticket_planning_last_ai_call
  ON ticket_planning(ticket_id, last_ai_call_at DESC);

-- Add planning context to usage_logs
ALTER TABLE usage_logs
  ADD COLUMN IF NOT EXISTS planning_stage VARCHAR(50),
  ADD COLUMN IF NOT EXISTS file_key VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_usage_logs_planning_stage
  ON usage_logs(ticket_id, planning_stage);
CREATE INDEX IF NOT EXISTS idx_usage_logs_file_key
  ON usage_logs(ticket_id, file_key);
```

#### `backend/src/migrations/038_planning_usage_columns_rollback.sql` (CREATE)

```sql
ALTER TABLE ticket_planning DROP COLUMN IF EXISTS last_tokens_in;
ALTER TABLE ticket_planning DROP COLUMN IF EXISTS last_tokens_out;
ALTER TABLE ticket_planning DROP COLUMN IF EXISTS last_cost_usd;
ALTER TABLE ticket_planning DROP COLUMN IF EXISTS last_duration_ms;
ALTER TABLE ticket_planning DROP COLUMN IF EXISTS last_provider_type;
ALTER TABLE ticket_planning DROP COLUMN IF EXISTS last_model;
ALTER TABLE ticket_planning DROP COLUMN IF EXISTS last_planning_stage;
ALTER TABLE ticket_planning DROP COLUMN IF EXISTS last_ai_call_at;
DROP INDEX IF EXISTS idx_ticket_planning_last_ai_call;

ALTER TABLE usage_logs DROP COLUMN IF EXISTS planning_stage;
ALTER TABLE usage_logs DROP COLUMN IF EXISTS file_key;
DROP INDEX IF EXISTS idx_usage_logs_planning_stage;
DROP INDEX IF EXISTS idx_usage_logs_file_key;
```

#### `backend/src/migrations/apply.js` (MODIFY)

Add `'038_planning_usage_columns.sql'` to the SQL_FILES array after 037.

#### `backend/src/services/UsageLogger.js` (MODIFY)

Extend `log()` method to accept optional `options` parameter:

```js
static async log(projectId, userId, agentId, providerType, model, usage, durationMs, ticketId, options = {}) {
  const { planningStage, fileKey } = options;
  const tokensIn = usage.input_tokens || usage.tokens_in || 0;
  const tokensOut = usage.output_tokens || usage.tokens_out || 0;
  const cost = calculateCost(model, tokensIn, tokensOut);
  
  await pool.query(`
    INSERT INTO usage_logs
      (project_id, user_id, agent_id, provider_type, model,
       tokens_in, tokens_out, cost_usd, duration_ms, ticket_id,
       planning_stage, file_key)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  `, [projectId, userId, agentId, providerType, model,
      tokensIn, tokensOut, cost, durationMs, ticketId || null,
      planningStage || null, fileKey || null]);
  
  // Update last-known usage on ticket_planning if fileKey provided
  if (fileKey && ticketId) {
    await pool.query(`
      UPDATE ticket_planning
      SET last_tokens_in = $1, last_tokens_out = $2, last_cost_usd = $3,
          last_duration_ms = $4, last_provider_type = $5, last_model = $6,
          last_planning_stage = $7, last_ai_call_at = NOW()
      WHERE ticket_id = $8 AND file_key = $9
    `, [tokensIn, tokensOut, cost, durationMs, providerType, model,
        planningStage || null, ticketId, fileKey]);
  }
}
```

Add new `logPlanningUsage()` method:

```js
static async logPlanningUsage(planData) {
  const {
    projectId, userId, agentId,
    ticketId, planningStage, fileKeys,
    providerType, model, tokensIn, tokensOut, durationMs,
  } = planData;
  
  const cost = calculateCost(model, tokensIn, tokensOut);
  
  if (fileKeys && fileKeys.length > 0) {
    for (const fk of fileKeys) {
      await pool.query(`
        INSERT INTO usage_logs
          (project_id, user_id, agent_id, provider_type, model,
           tokens_in, tokens_out, cost_usd, duration_ms, ticket_id,
           planning_stage, file_key)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `, [projectId, userId, agentId, providerType, model,
          tokensIn, tokensOut, cost, durationMs, ticketId,
          planningStage, fk]);
      
      await pool.query(`
        UPDATE ticket_planning
        SET last_tokens_in = $1, last_tokens_out = $2, last_cost_usd = $3,
            last_duration_ms = $4, last_provider_type = $5, last_model = $6,
            last_planning_stage = $7, last_ai_call_at = NOW()
        WHERE ticket_id = $8 AND file_key = $9
      `, [tokensIn, tokensOut, cost, durationMs, providerType, model,
          planningStage, ticketId, fk]);
    }
  } else {
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

#### `backend/src/api/v1/index.js` (MODIFY)

Extend the existing `POST /agents/:agentId/usage` handler to accept planning context:

```js
// Current handler (extend it):
router.post('/agents/:agentId/usage', authenticateAgentByApiKey, async (req, res, next) => {
  try {
    const agentId = parseInt(req.params.agentId);
    const { provider_type, model, tokens_in, tokens_out, duration_ms, ticket_id,
            planning_stage, file_keys } = req.body;
    
    if (!provider_type || !model || tokens_in == null || tokens_out == null) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Missing required fields' } });
    }
    
    const cost = calculateCost(model, tokens_in, tokens_out);
    
    // Primary entry
    await pool.query(`
      INSERT INTO usage_logs
        (agent_id, provider_type, model, tokens_in, tokens_out, cost_usd,
         duration_ms, ticket_id, planning_stage, file_key)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [agentId, provider_type, model, tokens_in, tokens_out, cost,
        duration_ms || 0, ticket_id || null, planning_stage || null,
        file_keys && file_keys.length > 0 ? file_keys[0] : null]);
    
    // Additional entries per file_key
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

Add new usage endpoints:

```js
// Aggregated per-stage usage for a ticket
router.get('/tickets/:ticketId/planning/usage', verifyToken, requireAnyPermission('MEMBER', 'PROJECT_ADMIN', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const ticketId = parseInt(req.params.ticketId);
    
    // Verify ticket belongs to user's project
    const ticketResult = await pool.query(
      'SELECT t.id, t.project_id, p.name as project_name FROM tickets t JOIN projects p ON t.project_id = p.id WHERE t.id = $1',
      [ticketId]
    );
    if (ticketResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
    }
    
    // Get per-stage aggregation
    const stageResult = await pool.query(`
      SELECT planning_stage,
             COALESCE(SUM(tokens_in), 0) as total_tokens_in,
             COALESCE(SUM(tokens_out), 0) as total_tokens_out,
             COALESCE(SUM(cost_usd), 0) as total_cost_usd,
             COALESCE(SUM(duration_ms), 0) as total_duration_ms,
             COUNT(*) as call_count
      FROM usage_logs
      WHERE ticket_id = $1 AND planning_stage IS NOT NULL
      GROUP BY planning_stage
      ORDER BY total_cost_usd DESC
    `, [ticketId]);
    
    // Get per-file aggregation
    const fileResult = await pool.query(`
      SELECT file_key,
             COALESCE(SUM(tokens_in), 0) as total_tokens_in,
             COALESCE(SUM(tokens_out), 0) as total_tokens_out,
             COALESCE(SUM(cost_usd), 0) as total_cost_usd
      FROM usage_logs
      WHERE ticket_id = $1 AND file_key IS NOT NULL
      GROUP BY file_key
      ORDER BY file_key
    `, [ticketId]);
    
    const byStage = {};
    for (const row of stageResult.rows) {
      byStage[row.planning_stage] = {
        tokensIn: parseInt(row.total_tokens_in),
        tokensOut: parseInt(row.total_tokens_out),
        costUsd: parseFloat(row.total_cost_usd),
        durationMs: parseInt(row.total_duration_ms),
        callCount: parseInt(row.call_count),
      };
    }
    
    const byFile = fileResult.rows.map(row => ({
      fileKey: row.file_key,
      tokensIn: parseInt(row.total_tokens_in),
      tokensOut: parseInt(row.total_tokens_out),
      costUsd: parseFloat(row.total_cost_usd),
    }));
    
    const totalCost = byStage[Object.keys(byStage)[0]]
      ? Object.values(byStage).reduce((sum, s) => sum + s.costUsd, 0)
      : 0;
    
    res.json({
      success: true,
      data: {
        ticketId,
        projectId: ticketResult.rows[0].project_id,
        projectName: ticketResult.rows[0].project_name,
        totalCost,
        totalTokensIn: Object.values(byStage).reduce((sum, s) => sum + s.tokensIn, 0),
        totalTokensOut: Object.values(byStage).reduce((sum, s) => sum + s.tokensOut, 0),
        totalDurationMs: Object.values(byStage).reduce((sum, s) => sum + s.durationMs, 0),
        byStage,
        byFile,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Per-file usage history
router.get('/tickets/:ticketId/planning/:fileKey/usage', verifyToken, requireAnyPermission('MEMBER', 'PROJECT_ADMIN', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const ticketId = parseInt(req.params.ticketId);
    const fileKey = req.params.fileKey;
    
    // Get last known usage from ticket_planning
    const lastResult = await pool.query(`
      SELECT last_tokens_in, last_tokens_out, last_cost_usd, last_duration_ms,
             last_provider_type, last_model, last_planning_stage, last_ai_call_at
      FROM ticket_planning
      WHERE ticket_id = $1 AND file_key = $2
    `, [ticketId, fileKey]);
    
    // Get full usage history from usage_logs
    const historyResult = await pool.query(`
      SELECT tokens_in, tokens_out, cost_usd, duration_ms,
             provider_type, model, planning_stage, created_at as at
      FROM usage_logs
      WHERE ticket_id = $1 AND file_key = $2
      ORDER BY created_at DESC
      LIMIT 50
    `, [ticketId, fileKey]);
    
    const lastUsage = lastResult.rows[0] ? {
      tokensIn: lastResult.rows[0].last_tokens_in || 0,
      tokensOut: lastResult.rows[0].last_tokens_out || 0,
      costUsd: parseFloat(lastResult.rows[0].last_cost_usd || 0),
      durationMs: lastResult.rows[0].last_duration_ms || 0,
      providerType: lastResult.rows[0].last_provider_type || null,
      model: lastResult.rows[0].last_model || null,
      planningStage: lastResult.rows[0].last_planning_stage || null,
      at: lastResult.rows[0].last_ai_call_at,
    } : null;
    
    const history = historyResult.rows.map(row => ({
      tokensIn: parseInt(row.tokens_in),
      tokensOut: parseInt(row.tokens_out),
      costUsd: parseFloat(row.cost_usd),
      durationMs: parseInt(row.duration_ms),
      providerType: row.provider_type,
      model: row.model,
      planningStage: row.planning_stage,
      at: row.at,
    }));
    
    res.json({
      success: true,
      data: {
        fileKey,
        lastUsage,
        history,
      },
    });
  } catch (err) {
    next(err);
  }
});
```

#### `backend/src/services/TicketPlanningService.js` (MODIFY)

Extend `list()` to include usage columns:

```js
async list(ticketId, _userId) {
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
  // ... same dedup logic ...
  return Object.values(latestFiles).map(f => ({
    key: f.file_key,
    content: f.content,
    version: f.version,
    updated_at: f.updated_at,
    created_by_name: f.created_by_name || null,
    ticket_title: f.ticket_title || null,
    // NEW: usage metadata
    last_tokens_in: f.last_tokens_in || 0,
    last_tokens_out: f.last_tokens_out || 0,
    last_cost_usd: parseFloat(f.last_cost_usd || 0),
    last_duration_ms: f.last_duration_ms || 0,
    last_provider_type: f.last_provider_type || null,
    last_model: f.last_model || null,
    last_planning_stage: f.last_planning_stage || null,
    last_ai_call_at: f.last_ai_call_at || null,
  }));
}
```

Same pattern for `get()` method.

#### `agent/src/main/java/.../service/ApiService.java` (MODIFY)

Extend `reportUsage()`:

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

#### `agent/src/main/java/.../service/TicketProcessor.java` (MODIFY)

Extend `generateContent()`:

```java
private String generateContent(Ticket ticket, List<String> planningDocs) throws IOException {
    // NEW: Infer planning stage and extract file keys
    String planningStage = inferPlanningStage(planningDocs);
    List<String> fileKeys = extractFileKeys(planningDocs);
    
    List<String> fileContext = null;
    try {
        fileContext = workspaceManager.getRepoFileList();
    } catch (IOException e) {
        log.warn("Could not read repo file list: {}", e.getMessage());
    }
    String systemPrompt = buildSystemPrompt(ticket, planningDocs, fileContext);
    String userMessage = "Ticket: " + ticket.getTitle() + "\n\n" + ticket.getDescription();
    
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

// NEW: Infer which planning stage this AI call belongs to
private String inferPlanningStage(List<String> planningDocs) {
    boolean hasImplementation = planningDocs.stream()
        .anyMatch(d -> d.contains("03_ARCHITECT_IMPLEMENTATION") || d.contains("03_TECHNICAL_IMPLEMENTATION") || d.contains("03_SIMPLE_TASKS"));
    boolean hasDesign = planningDocs.stream()
        .anyMatch(d -> d.contains("02_ARCHITECT_DESIGN") || d.contains("02_TECHNICAL_DESIGN"));
    boolean hasRequirement = planningDocs.stream()
        .anyMatch(d -> d.contains("01_ARCHITECT_REQUIREMENT") || d.contains("01_TECHNICAL_REQUIREMENT") || d.contains("01_SIMPLE_TASKS"));
    
    if (hasImplementation) return "validation";
    if (hasDesign) return "plan_generation";
    if (hasRequirement) return "requirement_extraction";
    return "requirement_extraction";
}

// NEW: Extract file keys from planning docs (format: "=== file_key ===")
private List<String> extractFileKeys(List<String> planningDocs) {
    List<String> keys = new ArrayList<>();
    for (String doc : planningDocs) {
        if (doc.startsWith("=== ")) {
            int end = doc.indexOf(" ===");
            if (end > 0) {
                keys.add(doc.substring(4, end));
            }
        }
    }
    return keys;
}
```

#### `frontend/src/api/client.ts` (MODIFY)

Add new API client methods:

```ts
export function getTicketPlanningUsage(ticketId: number) {
  return apiClient.get<{
    success: true;
    data: {
      ticketId: number;
      projectId: number;
      projectName: string;
      totalCost: number;
      totalTokensIn: number;
      totalTokensOut: number;
      totalDurationMs: number;
      byStage: Record<string, {
        tokensIn: number;
        tokensOut: number;
        costUsd: number;
        durationMs: number;
        callCount: number;
      }>;
      byFile: Array<{
        fileKey: string;
        tokensIn: number;
        tokensOut: number;
        costUsd: number;
      }>;
    };
  }>(`/tickets/${ticketId}/planning/usage`);
}

export function getPlanningFileUsage(ticketId: number, fileKey: string) {
  return apiClient.get<{
    success: true;
    data: {
      fileKey: string;
      lastUsage: {
        tokensIn: number;
        tokensOut: number;
        costUsd: number;
        durationMs: number;
        providerType: string | null;
        model: string | null;
        planningStage: string | null;
        at: string | null;
      } | null;
      history: Array<{
        tokensIn: number;
        tokensOut: number;
        costUsd: number;
        durationMs: number;
        providerType: string | null;
        model: string | null;
        planningStage: string | null;
        at: string | null;
      }>;
    };
  }>(`/tickets/${ticketId}/planning/${encodeURIComponent(fileKey)}/usage`);
}
```

---

### d) Dependencies

- [Backend service]: `UsageLogger.log()` extended with planning context
- [Backend service]: `UsageLogger.logPlanningUsage()` — new method
- [Backend service]: `TicketPlanningService.list/get` include usage columns
- [Backend route]: `POST /agents/:agentId/usage` extended with planning_stage, file_keys
- [Backend route]: `GET /tickets/:ticketId/planning/usage` — new endpoint
- [Backend route]: `GET /tickets/:ticketId/planning/:fileKey/usage` — new endpoint
- [Java agent]: `ApiService.reportUsage()` extended
- [Java agent]: `TicketProcessor` with planning stage inference
- [Frontend API]: `getTicketPlanningUsage()`, `getPlanningFileUsage()`

---

### e) Risks/Edge Cases

- **[Double cost counting]**: Each file_key gets a full-cost usage entry. For billing, aggregate at `planning_stage` level, not per file.
- **[Inferred stage is wrong]**: `inferPlanningStage()` is heuristic-based. If a ticket has all planning docs, it returns "validation". This is acceptable — the stage represents the AI call's purpose, not just which docs were read.
- **[Existing usage_logs rows have NULL planning_stage]**: Queries should use `COALESCE` and `IS NOT NULL` filters.
- **[Migration on non-empty table]**: New columns have defaults, so existing data is safe.

---

### f) Testing

#### Backend Unit Tests
- [ ] `UsageLogger.log()` with `planning_stage` and `file_key` inserts correctly
- [ ] `UsageLogger.log()` updates `ticket_planning.last_*` when `file_key` provided
- [ ] `UsageLogger.logPlanningUsage()` creates entries per file_key
- [ ] `GET /tickets/:ticketId/planning/usage` returns correct aggregation
- [ ] `GET /tickets/:ticketId/planning/:fileKey/usage` returns correct history
- [ ] `POST /agents/:agentId/usage` with `file_keys` creates multiple entries
- [ ] Permission checks: `user` role denied, `member`+ allowed

#### Backend Integration Tests
- [ ] Full flow: agent reports usage with planning context → API returns breakdown
- [ ] Usage columns persist in `ticket_planning` after usage report

#### Java Agent Tests
- [ ] `inferPlanningStage()` returns correct stage for different doc combinations
- [ ] `extractFileKeys()` parses file keys from doc format
- [ ] `reportUsage()` includes planning_stage and file_keys in request body

#### Frontend Tests
- [ ] Usage breakdown component renders with mock data
- [ ] Usage indicator on planning file shows correct values
- [ ] Empty usage state renders correctly
- [ ] API client methods construct correct URLs

---

### g) Migration Notes

Migration: `backend/src/migrations/038_planning_usage_columns.sql`
- Adds 8 columns to `ticket_planning` (all nullable with defaults)
- Adds 2 columns to `usage_logs` (nullable)
- Adds 4 indexes

Rollback: `backend/src/migrations/038_planning_usage_columns_rollback.sql`
- Drops all added columns and indexes

---

### h) Files Changed

**Backend:**
```
backend/src/migrations/038_planning_usage_columns.sql              → CREATE
backend/src/migrations/038_planning_usage_columns_rollback.sql     → CREATE
backend/src/migrations/apply.js                                    → MODIFY
backend/src/services/UsageLogger.js                                → MODIFY
backend/src/services/TicketPlanningService.js                      → MODIFY
backend/src/api/v1/index.js                                        → MODIFY (add 2 routes)
```

**Java Agent:**
```
agent/.../service/ApiService.java       → MODIFY (extend reportUsage)
agent/.../service/TicketProcessor.java  → MODIFY (add planning context)
```

**Frontend:**
```
frontend/src/api/client.ts              → MODIFY (add 2 API methods)
frontend/src/views/TicketDetail.vue     → MODIFY (add usage section)
frontend/src/views/PlanningViewer.vue   → MODIFY (add usage indicators)
```

**Tests:**
```
backend/src/__tests__/usageLogger.test.js         → EXTEND
backend/src/__tests__/api-ticketPlanning.test.js  → CREATE
backend/src/__tests__/api-usage.test.js           → EXTEND
frontend/src/__tests__/api-client.test.ts         → EXTEND
```

---

### i) Code Review Checklist

- [ ] Migration: columns are nullable with defaults (backward compatible)
- [ ] Migration: rollback script drops all added columns/indexes
- [ ] Backend: `planning_stage` values are controlled enum (no user input)
- [ ] Backend: cost always calculated server-side via `calculateCost()`
- [ ] Backend: agent can only report usage for its own agent_id
- [ ] Backend: permission checks use `MEMBER`+ for cost data
- [ ] Java: `inferPlanningStage()` handles all doc combinations
- [ ] Java: usage reporting failure doesn't break ticket processing
- [ ] Frontend: usage values formatted consistently (tokens as integers, cost to 4 decimals)
- [ ] Tests: permission denied test included
- [ ] Tests: empty usage state handled
- [ ] OpenAPI: new endpoints documented with JSDoc

---

### j) Post-Deploy Verification

1. [ ] Backend: `npm test` passes
2. [ ] Backend: `npm run lint` passes
3. [ ] Backend: `npm run test:coverage` passes (60% threshold)
4. [ ] Java agent: `mvn clean package` compiles
5. [ ] Frontend: `npm run lint` passes
6. [ ] Frontend: `npm run typecheck` passes
7. [ ] Frontend: `npm test -- --run` passes
8. [ ] Migration applied: `ticket_planning` has usage columns
9. [ ] Migration applied: `usage_logs` has `planning_stage` and `file_key`
10. [ ] Agent reports usage with planning context
11. [ ] `GET /tickets/:id/planning/usage` returns per-stage breakdown
12. [ ] `GET /tickets/:id/planning/:fileKey/usage` returns history
13. [ ] Frontend displays usage indicators on planning files
14. [ ] Frontend displays usage breakdown on ticket detail

---

### Pending Scope Items to Present to User

| Item | Source | Category | Priority |
|------|--------|----------|----------|
| bp-75: Log file rotation | PENDING.txt | Infrastructure | P3 |
| bp-78: CSP violation reporting dashboard | PENDING.txt | Security | P2 |
| bp-79: Migration dry-run mode | PENDING.txt | Developer experience | P2 |
| bp-80: PgBouncer deployment | PENDING.txt | Infrastructure | P2 |
| bp-81: Agent bug fixes | PENDING.txt | Stability | unspecified |

---

*Fill in all sections before starting implementation.*
