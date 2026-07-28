# 04_SPECIFICATION.md — Structured Telemetry Events (Three-Layer Canonical Payload)

**Use this file when a small model (7B–34B) will execute the ticket.**
This file bridges the planning docs (01–03) and the code. It specifies exact file operations, imports, function signatures, test expectations, and edge cases.

**Generated from**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`
**Target model**: 34B local model
**Date**: 2026-07-27

---

## Test-First Requirement

**Test stub files MUST be created before any production code.** This prevents the model from skipping tests.

The model MUST:
1. Create **empty test stub files** (with imports, `describe` blocks, and stub `it` blocks) for every test file listed in "Test Expectations" below
2. Create **production code files** (EventHashService, migration, UsageLogger updates, provider updates)
3. Fill in the test stubs with actual assertions

Only after all test stubs exist as empty files may the model begin implementing production code. Do not defer test creation to a later step.

---

## File Operations

### CREATE: `backend/src/migrations/040_telemetry_events.sql`

**Content** (exact):
```sql
-- Migration: 040_telemetry_events.sql
-- Structured telemetry events with three-layer canonical payload

CREATE TABLE IF NOT EXISTS telemetry_events (
  id BIGSERIAL PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1,
  content_hash VARCHAR(64) NOT NULL,
  provider_type VARCHAR(50) NOT NULL,
  model VARCHAR(100) NOT NULL,
  raw_provider_fields JSONB NOT NULL DEFAULT '{}',
  normalized_fields JSONB NOT NULL DEFAULT '{}',
  derived_metrics JSONB NOT NULL DEFAULT '{}',
  field_provenance JSONB NOT NULL DEFAULT '{}',
  project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
  user_id BIGINT REFERENCES users(id),
  agent_id BIGINT REFERENCES agents(id) ON DELETE SET NULL,
  ticket_id BIGINT REFERENCES tickets(id),
  planning_stage VARCHAR(50),
  file_key VARCHAR(100),
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(content_hash)
);

CREATE INDEX IF NOT EXISTS idx_telemetry_events_content_hash ON telemetry_events(content_hash);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_provider_model ON telemetry_events(provider_type, model);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_project_id ON telemetry_events(project_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_created_at ON telemetry_events(created_at);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_agent_id ON telemetry_events(agent_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_ticket_id ON telemetry_events(ticket_id);
```

### CREATE: `backend/src/migrations/040_telemetry_events_rollback.sql`

**Content** (exact):
```sql
DROP TABLE IF EXISTS telemetry_events;
```

### MODIFY: `backend/src/migrations/apply.js`

**Add to SQL_FILES array**: `'040_telemetry_events.sql'` after `'039_create_csp_violations.sql'`

### CREATE: `backend/src/services/EventHashService.js`

**Imports** (exact):
```javascript
const crypto = require('crypto');
```

**Functions** (exact signatures):
```javascript
class EventHashService {
  /**
   * Deterministic JSON serialization: sorted keys, no whitespace.
   * @param {Object} obj - object to canonicalize
   * @returns {string} canonical JSON string
   */
  static canonicalize(obj) {
    // Sort keys recursively, then JSON.stringify with no spaces
    // Use replacer to sort object keys
    return JSON.stringify(obj, Object.keys(obj).sort());
  }

  /**
   * Compute SHA-256 content hash of a payload.
   * @param {Object} payload - the three-layer payload object
   * @returns {string} 64-char hex SHA-256 hash
   */
  static computeHash(payload) {
    const canonical = EventHashService.canonicalize(payload);
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }
}

module.exports = EventHashService;
```

**Position in file**: New file

### MODIFY: `backend/src/services/UsageLogger.js`

**Add imports** (at top of file):
```javascript
const EventHashService = require('./EventHashService');
```

**Add methods** (after existing static methods, before `module.exports`):

```javascript
static _buildRawProviderFields(providerType, rawUsage) {
  if (!rawUsage || typeof rawUsage !== 'object') return {};
  const raw = { ...rawUsage };
  // Remove any internal fields that aren't provider-reported
  delete raw._request_id;
  delete raw._response_ms;
  return raw;
}

static _buildNormalizedFields(providerType, rawUsage, durationMs, model) {
  const raw = rawUsage || {};
  let tokensIn = 0;
  let tokensOut = 0;

  if (providerType === 'claude') {
    tokensIn = raw.input_tokens || 0;
    tokensOut = raw.output_tokens || 0;
  } else if (providerType === 'openai' || providerType === 'generic') {
    tokensIn = raw.prompt_tokens || 0;
    tokensOut = raw.completion_tokens || 0;
  }

  return {
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    tokens_total: tokensIn + tokensOut,
    duration_ms: durationMs || 0,
    provider_type: providerType,
    model: model || 'unknown',
  };
}

static _buildDerivedMetrics(normalizedFields, model) {
  const { tokens_in, tokens_out, duration_ms } = normalizedFields;
  const cost = calculateCost(model, tokens_in, tokensOut);
  const tokensPerSecond = duration_ms > 0
    ? Math.round((tokens_out / (duration_ms / 1000)) * 10) / 10
    : 0;

  return {
    cost_usd: cost,
    tokens_per_second: tokensPerSecond,
  };
}

static _buildFieldProvenance(providerType) {
  const provenance = {
    raw_provider_fields: 'raw:provider_response',
    'normalized_fields.duration_ms': 'raw:backend_measured',
    'derived_metrics.cost_usd': 'derived:pricing.js(model,tokens_in,tokens_out)',
    'derived_metrics.tokens_per_second': 'derived:tokens_out/duration_ms',
  };

  if (providerType === 'claude') {
    provenance['normalized_fields.tokens_in'] = 'normalized:input_tokens→tokens_in';
    provenance['normalized_fields.tokens_out'] = 'normalized:output_tokens→tokens_out';
  } else {
    provenance['normalized_fields.tokens_in'] = 'normalized:prompt_tokens→tokens_in';
    provenance['normalized_fields.tokens_out'] = 'normalized:completion_tokens→tokens_out';
  }

  return provenance;
}

static async logStructuredEvent({
  providerType, model, rawUsage, durationMs,
  projectId, userId, agentId, ticketId, planningStage, fileKey,
}) {
  try {
    const rawProviderFields = UsageLogger._buildRawProviderFields(providerType, rawUsage);
    const normalizedFields = UsageLogger._buildNormalizedFields(providerType, rawUsage, durationMs, model);
    const derivedMetrics = UsageLogger._buildDerivedMetrics(normalizedFields, model);
    const fieldProvenance = UsageLogger._buildFieldProvenance(providerType);

    const payload = {
      schema_version: 1,
      provider_type: providerType,
      model: model || 'unknown',
      raw_provider_fields: rawProviderFields,
      normalized_fields: normalizedFields,
      derived_metrics: derivedMetrics,
      field_provenance: fieldProvenance,
    };

    const contentHash = EventHashService.computeHash(payload);

    await pool.query(
      `INSERT INTO telemetry_events
       (schema_version, content_hash, provider_type, model,
        raw_provider_fields, normalized_fields, derived_metrics, field_provenance,
        project_id, user_id, agent_id, ticket_id, planning_stage, file_key, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (content_hash) DO NOTHING`,
      [
        1, contentHash, providerType, model || 'unknown',
        JSON.stringify(rawProviderFields), JSON.stringify(normalizedFields),
        JSON.stringify(derivedMetrics), JSON.stringify(fieldProvenance),
        projectId || null, userId || null, agentId || null,
        ticketId || null, planningStage || null, fileKey || null,
        durationMs || 0,
      ]
    );
  } catch (e) {
    // Non-blocking: log warning but don't fail the original operation
    logger.warn('Failed to write structured telemetry event:', e.message);
  }
}
```

**Modify existing methods** — add dual-write calls:

In `log()` method, after the existing INSERT into `usage_logs`, add:
```javascript
// Dual-write to telemetry_events
await UsageLogger.logStructuredEvent({
  providerType, model, rawUsage: options.rawUsage,
  durationMs, projectId, userId, agentId, ticketId,
  planningStage, fileKey,
});
```

In `reportUsage()` method, after the existing INSERT into `usage_logs`, add:
```javascript
// Dual-write to telemetry_events
await UsageLogger.logStructuredEvent({
  providerType: data.provider_type, model: data.model,
  rawUsage: data.raw_usage, durationMs: data.duration_ms,
  projectId: data.project_id, userId: null, agentId,
  ticketId: data.ticket_id, planningStage: data.planning_stage,
  fileKey: primaryFileKey,
});
```

In `logPlanningUsage()` method, after the existing INSERT into `usage_logs`, add:
```javascript
// Dual-write to telemetry_events
await UsageLogger.logStructuredEvent({
  providerType, model, rawUsage: planData.rawUsage,
  durationMs, projectId, userId, agentId, ticketId,
  planningStage, fileKey: fk,
});
```

### MODIFY: `backend/src/providers/claude/index.js`

**Modify**: `chat()` method — capture raw response.usage and pass to UsageLogger:

Change the UsageLogger.log() call from:
```javascript
await UsageLogger.log(
  this.projectId, this.userId, this.agentId,
  'claude', this.model, usage, duration, this.ticketId
);
```

To:
```javascript
await UsageLogger.log(
  this.projectId, this.userId, this.agentId,
  'claude', this.model, usage, duration, this.ticketId,
  { rawUsage: response.usage }
);
```

### MODIFY: `backend/src/providers/openai/index.js`

**Modify**: `chat()` method — capture raw response.usage and pass to UsageLogger:

Change the UsageLogger.log() call from:
```javascript
await UsageLogger.log(
  this.projectId, this.userId, this.agentId,
  'openai', this.model, usage, duration, this.ticketId
);
```

To:
```javascript
await UsageLogger.log(
  this.projectId, this.userId, this.agentId,
  'openai', this.model, usage, duration, this.ticketId,
  { rawUsage: response.usage }
);
```

### MODIFY: `backend/src/providers/generic/index.js`

**Modify**: `chat()` method — capture raw response.data.usage and pass to UsageLogger:

Change the UsageLogger.log() call from:
```javascript
await UsageLogger.log(
  this.projectId, this.userId, this.agentId,
  'generic', this.model, usage, duration, this.ticketId
);
```

To:
```javascript
await UsageLogger.log(
  this.projectId, this.userId, this.agentId,
  'generic', this.model, usage, duration, this.ticketId,
  { rawUsage: response.data.usage }
);
```

---

## Test Expectations

### Backend Unit Tests — EventHashService
```
✓ [happy] canonicalize({b:2, a:1}) returns '{"a":1,"b":2}'
✓ [happy] canonicalize({a:{c:3, b:2}}) returns '{"a":{"b":2,"c":3}}'
✓ [happy] computeHash({a:1}) returns 64-char hex string
✓ [happy] computeHash({a:1}) is deterministic (same input → same output)
✓ [happy] computeHash({a:1}) != computeHash({a:2}) (different input → different output)
✓ [happy] computeHash({a:1, b:2}) == computeHash({b:2, a:1}) (key order doesn't matter)
✓ [edge] computeHash({}) returns consistent hash for empty object
```

### Backend Unit Tests — Telemetry Event Payload
```
✓ [happy] Claude: three-layer payload has correct raw_provider_fields structure
✓ [happy] Claude: normalized_fields.tokens_in maps from input_tokens
✓ [happy] OpenAI: normalized_fields.tokens_in maps from prompt_tokens
✓ [happy] Generic: normalized_fields.tokens_in maps from prompt_tokens
✓ [happy] Generic: unknown fields go to raw_provider_fields additional key
✓ [happy] derived_metrics.cost_usd is calculated correctly
✓ [happy] derived_metrics.tokens_per_second is calculated correctly
✓ [happy] field_provenance has correct entries for Claude
✓ [happy] field_provenance has correct entries for OpenAI
✓ [edge] null rawUsage produces empty raw_provider_fields
✓ [edge] duration_ms=0: tokens_per_second is 0 (no division by zero)
```

### Backend Unit Tests — UsageLogger Dual-Write
```
✓ [happy] log() inserts into both usage_logs and telemetry_events
✓ [happy] reportUsage() inserts into both tables
✓ [happy] logPlanningUsage() inserts into both tables
✓ [happy] telemetry_events row has correct three-layer structure
✓ [happy] telemetry_events row has content_hash
✓ [happy] duplicate content_hash is ignored (ON CONFLICT DO NOTHING)
✓ [error] telemetry_events write failure doesn't fail the original operation
```

---

## Edge Cases to Handle

1. **Provider returns null/undefined usage**: Fall back to zeros for all token counts
2. **Generic provider returns extra fields**: Store in `raw_provider_fields` as-is (spread all keys)
3. **Same event written twice**: `UNIQUE(content_hash)` prevents duplicate rows
4. **Hash computation throws**: Log warning, write event with `content_hash = NULL` (catch block)
5. **duration_ms is 0**: `tokens_per_second` = 0 (guard: `duration_ms > 0 ? ... : 0`)
6. **Backward compatibility**: `options.rawUsage` may be undefined in old callers — handle gracefully

---

## Existing Code Patterns to Follow

- Use `pool.query()` with parameterized queries (existing pattern in UsageLogger)
- Error handling: try/catch with `logger.warn()` for non-critical failures (existing pattern in providers)
- Migration format: matches existing `NNN_name.sql` convention
- Test format: Jest with `describe`/`it` blocks, matching existing `__tests__/*.test.js` pattern
- Service class pattern: static methods on a class (existing UsageLogger pattern)
- No new npm dependencies — `crypto` is Node.js built-in

---

## Pending Scope Items

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-76 | Distributed tracing / OpenTelemetry spans | Observability | bp-110-distributed-tracing | ☐ |
| 2 | bp-106 | Log aggregation transport | Observability | bp-106-log-aggregation | ☐ |
| 3 | bp-101 | Configurable log rotation | Developer experience | bp-101-configurable-log-rotation | ☐ |
| 4 | bp-78 | CSP DB ingestion gap | Observability | bp-111-csp-db-ingestion | ☐ |
| 5 | bp-78 | CSP router mount | Bug fix | bp-112-csp-router-mount | ☐ |
| 6 | bp-78 | CSP cleanup scheduling | Bug fix | bp-113-csp-cleanup-schedule | ☐ |

---

## Files NOT to Change

- `backend/src/api/usage.js` — no API shape changes
- `backend/src/controllers/usageController.js` — no controller changes
- `backend/src/utils/pricing.js` — used as-is by UsageLogger
- `frontend/` — no frontend changes
- `backend/src/api/v1/index.js` — no new routes
- `backend/src/api/routes.js` — no route changes

---

*This specification is the contract between planning and execution. If the model cannot produce code matching this spec, it should request human feedback rather than guessing.*
