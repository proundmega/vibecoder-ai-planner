# 02_ARCHITECT_DESIGN.md — Structured Telemetry Events (Three-Layer Canonical Payload)

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, `04_SPECIFICATION.md`

---

## Problem Statement

The current telemetry system stores AI usage data in a flat `usage_logs` table where provider-specific fields are silently normalized at write time. There is no record of what the provider actually reported, no schema versioning, no field provenance, and no content-addressing. This means:

- A signed event preserves ambiguity rather than removing it
- Schema changes break existing queries silently
- There's no way to verify what was "raw" vs "normalized" vs "derived"
- Deduplication is impossible without comparing all fields

---

## Current State

### Existing Backend
- **UsageLogger service** (`backend/src/services/UsageLogger.js`): Writes to `usage_logs` with flat columns (`tokens_in`, `tokens_out`, `cost_usd`, `provider_type`, `model`)
- **Three providers** (Claude, OpenAI, Generic): Each passes a `usage` object with provider-specific keys that get normalized at INSERT time
  - Claude: `{ input_tokens, output_tokens }` → normalized to `tokens_in`, `tokens_out`
  - OpenAI: `{ prompt_tokens, completion_tokens, total_tokens }` → normalized to `tokens_in`, `tokens_out`
  - Generic: `{ prompt_tokens, completion_tokens, total_tokens }` → normalized to `tokens_in`, `tokens_out`
- **`usage_logs` table**: Flat schema with `metadata JSONB DEFAULT '{}'` — loosely structured
- **Pricing utility** (`backend/src/utils/pricing.js`): Computes `cost_usd` from model + token counts

### Existing Frontend
- No changes needed — frontend reads via existing API endpoints that query `usage_logs`

### Gap Analysis
- **No three-layer structure**: Raw provider fields, normalized fields, and derived metrics are collapsed into a single flat row
- **No schema versioning**: If the event shape changes, there's no way to know which version a row conforms to
- **No field provenance**: Can't distinguish "this value came from the provider" vs "this was computed by the backend"
- **No content-addressing**: Can't deduplicate or verify events by content hash

---

## Design

### Option A: New Table with Three-Layer JSONB Payload (Recommended)

Create a new `telemetry_events` table with an explicit three-layer structure. The `usage_logs` table continues to work via dual-write.

```
telemetry_events table:
  id                  BIGSERIAL PRIMARY KEY
  schema_version      INTEGER NOT NULL DEFAULT 1
  content_hash        VARCHAR(64) NOT NULL  -- SHA-256 hex
  provider_type       VARCHAR(50) NOT NULL
  model               VARCHAR(100) NOT NULL
  
  -- Layer 1: Raw provider-reported fields (verbatim from API response)
  raw_provider_fields JSONB NOT NULL        -- { input_tokens: 150, output_tokens: 50, ... }
  
  -- Layer 2: Normalized fields (standardized across providers)
  normalized_fields   JSONB NOT NULL        -- { tokens_in: 150, tokens_out: 50, duration_ms: 1200 }
  
  -- Layer 3: Derived metrics (computed from raw+normalized)
  derived_metrics     JSONB NOT NULL        -- { cost_usd: 0.0045, tokens_per_second: 41.7 }
  
  -- Provenance: which rule produced each field
  field_provenance    JSONB NOT NULL        -- { tokens_in: "normalized:input_tokens→tokens_in", cost_usd: "derived:pricing.js" }
  
  -- Context
  project_id          BIGINT REFERENCES projects(id)
  user_id             BIGINT REFERENCES users(id)
  agent_id            BIGINT REFERENCES agents(id)
  ticket_id           BIGINT REFERENCES tickets(id)
  planning_stage      VARCHAR(50)
  file_key            VARCHAR(100)
  duration_ms         INTEGER NOT NULL DEFAULT 0
  
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  
  UNIQUE(content_hash)  -- Content-addressing: identical events have identical hashes
```

**Why a new table instead of altering `usage_logs`?**
- Zero risk to existing queries
- Clean separation of concerns
- `usage_logs` can be deprecated gradually
- The new schema is fundamentally different (three JSONB layers vs flat columns)

### Option B: Alter `usage_logs` in Place

Add JSONB columns to the existing table.

**Pros**: No dual-write needed
**Cons**: Risk to existing queries, migration complexity, mixing old and new patterns
**Decision**: Not chosen — too risky for a structural change

### Option C: Separate `telemetry_events` table, no dual-write

Write only to the new table, update reads to query it.

**Pros**: Clean, no duplication
**Cons**: Breaks existing aggregation queries, requires frontend read migration
**Decision**: Not chosen — too much scope for this ticket

---

## Three-Layer Payload Structure

### Layer 1: Raw Provider-Reported Fields

Verbatim fields from the AI provider's API response. Never modified.

```json
{
  "claude": {
    "input_tokens": 150,
    "output_tokens": 50,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0
  },
  "openai": {
    "prompt_tokens": 150,
    "completion_tokens": 50,
    "total_tokens": 200
  },
  "generic": {
    "prompt_tokens": 150,
    "completion_tokens": 50,
    "total_tokens": 200,
    "additional": { "...any extra fields..." }
  }
}
```

**Provenance tag**: `"raw:provider_response"`

### Layer 2: Normalized Fields

Standardized across all providers. Same semantic meaning regardless of provider.

```json
{
  "tokens_in": 150,
  "tokens_out": 50,
  "tokens_total": 200,
  "duration_ms": 1200,
  "provider_type": "claude",
  "model": "claude-sonnet-4-20250514"
}
```

**Provenance tags**:
- `"normalized:input_tokens→tokens_in"` (Claude path)
- `"normalized:prompt_tokens→tokens_in"` (OpenAI/Generic path)
- `"raw:duration_ms"` (measured by backend, not provider)

### Layer 3: Derived Metrics

Computed from raw + normalized fields.

```json
{
  "cost_usd": 0.0045,
  "tokens_per_second": 41.7,
  "input_ratio": 0.75,
  "output_ratio": 0.25
}
```

**Provenance tags**:
- `"derived:pricing.js(model,tokens_in,tokens_out)→cost_usd"`
- `"derived:tokens_out/duration_ms→tokens_per_second"`
- `"derived:tokens_in/tokens_total→input_ratio"`

### Field Provenance Map

Every field in the three layers gets a provenance entry:

```json
{
  "raw_provider_fields": "raw:provider_response",
  "normalized_fields.tokens_in": "normalized:input_tokens→tokens_in",
  "normalized_fields.tokens_out": "normalized:output_tokens→tokens_out",
  "derived_metrics.cost_usd": "derived:pricing.js(model,tokens_in,tokens_out)",
  "derived_metrics.tokens_per_second": "derived:tokens_out/duration_ms"
}
```

### Content-Addressing (SHA-256)

The `content_hash` is computed over a **canonical serialization** of the three-layer payload:

1. Construct the payload object: `{ schema_version, provider_type, model, raw_provider_fields, normalized_fields, derived_metrics }`
2. Deterministically serialize: `JSON.stringify(payload, Object.keys(payload).sort())` (sorted keys, no whitespace)
3. Hash: `crypto.createHash('sha256).update(canonical).digest('hex')`

This ensures:
- Identical events produce identical hashes (deduplication)
- Any modification to the payload changes the hash (integrity)
- The hash is compact (64 hex chars) and indexable

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/services/UsageLogger.js` | MODIFY | Add `logStructuredEvent()` method, dual-write in `log()`, `reportUsage()`, `logPlanningUsage()` |
| `backend/src/services/EventHashService.js` | CREATE | Content-addressing: `computeHash(payload)`, `canonicalize(payload)` |
| `backend/src/providers/claude/index.js` | MODIFY | Capture raw `response.usage` object, pass to UsageLogger |
| `backend/src/providers/openai/index.js` | MODIFY | Capture raw `response.usage` object, pass to UsageLogger |
| `backend/src/providers/generic/index.js` | MODIFY | Capture raw `response.data.usage` object, pass to UsageLogger |
| `backend/src/migrations/040_telemetry_events.sql` | CREATE | New table + indexes |
| `backend/src/migrations/040_telemetry_events_rollback.sql` | CREATE | Rollback SQL |
| `backend/src/migrations/apply.js` | MODIFY | Add 040 to SQL_FILES array |
| `backend/src/__tests__/eventHashService.test.js` | CREATE | Unit tests for hashing |
| `backend/src/__tests__/telemetryEvents.test.js` | CREATE | Unit tests for three-layer payload |
| `backend/src/__tests__/usageLogger.test.js` | MODIFY | Extend with dual-write tests |

---

## Data Flow Diagram

```
[AI Provider API] → [Provider.chat()]
       ↓
  Raw response: { usage: { input_tokens: 150, output_tokens: 50 } }
       ↓
  [UsageLogger.log()]
       ↓
  ┌─────────────────────────────────────────────────┐
  │  Construct Three-Layer Payload                   │
  │                                                  │
  │  raw_provider_fields = { ...response.usage }     │
  │  normalized_fields = {                           │
  │    tokens_in: raw.input_tokens || raw.prompt_tokens,
  │    tokens_out: raw.output_tokens || raw.completion_tokens,
  │    duration_ms: measured                         │
  │  }                                               │
  │  derived_metrics = {                             │
  │    cost_usd: calculateCost(model, tokens_in, tokens_out),
  │    tokens_per_second: tokens_out / (duration_ms / 1000)
  │  }                                               │
  │  field_provenance = { ...provenance map }        │
  │  content_hash = SHA-256(canonical(payload))      │
  └─────────────────────────────────────────────────┘
       ↓                        ↓
  [INSERT usage_logs]    [INSERT telemetry_events]
  (flat columns)         (three-layer JSONB)
       ↓                        ↓
  [Existing queries]    [New queries / verification]
```

---

## Dependencies

### Backend Dependencies
- `crypto` (Node.js built-in) — for SHA-256 hashing
- `UsageLogger` — existing service to extend
- `pricing.js` — existing cost calculation utility
- All three providers (Claude, OpenAI, Generic) — to capture raw fields

### Frontend Dependencies
- None — no API shape changes

### Cross-Cutting Dependencies
- None — no OpenAPI spec changes needed

---

## Config / Environment Changes

- [ ] New environment variables: NONE
- [ ] New database migrations: `040_telemetry_events.sql`
- [ ] New npm dependencies: NONE (crypto is built-in)
- [ ] Existing config changes: NONE

---

## Database Changes

### New Table
```sql
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
```

### Indexes
```sql
CREATE INDEX idx_telemetry_events_content_hash ON telemetry_events(content_hash);
CREATE INDEX idx_telemetry_events_provider_model ON telemetry_events(provider_type, model);
CREATE INDEX idx_telemetry_events_project_id ON telemetry_events(project_id);
CREATE INDEX idx_telemetry_events_created_at ON telemetry_events(created_at);
CREATE INDEX idx_telemetry_events_agent_id ON telemetry_events(agent_id);
CREATE INDEX idx_telemetry_events_ticket_id ON telemetry_events(ticket_id);
```

### Migrations
- [ ] Migration `040_telemetry_events.sql` — creates table + indexes
- [ ] Rollback `040_telemetry_events_rollback.sql` — drops table

---

## Security Considerations

- [x] Authentication required: NO — internal write-path after authenticated AI calls
- [x] Authorization check: N/A — server-side only
- [x] Input validation: YES — raw provider fields must be sanitized (no script injection in JSONB)
- [x] Rate limiting: N/A — internal write-path
- [x] Sensitive data in responses: N/A — not exposed via API yet
- [x] SQL injection protection: parameterized queries used

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Backend unit | Jest | `backend/src/__tests__/eventHashService.test.js` | Hash determinism, canonicalization, edge cases |
| Backend unit | Jest | `backend/src/__tests__/telemetryEvents.test.js` | Three-layer payload construction, provenance |
| Backend unit | Jest | `backend/src/__tests__/usageLogger.test.js` (EXTEND) | Dual-write correctness |
| Backend unit | Jest | `backend/src/__tests__/usageLogger.test.js` (EXTEND) | Existing tests still pass |

### Test-First Requirement

If `04_SPECIFICATION.md` exists, create test stubs before production code.

---

## Risks and Edge Cases

### Backend Risks
- **Dual-write latency**: Writing to two tables adds ~1-5ms per AI call. At current scale (~500 calls/day), this is negligible.
- **Schema version evolution**: When `schema_version` increments, old rows keep their version. New code must handle both versions.

### Edge Cases
- **Provider returns null/undefined usage**: Fall back to zeros, log warning, still write event
- **Generic provider returns unknown fields**: Store in `raw_provider_fields.additional` sub-key
- **Same event written twice**: `UNIQUE(content_hash)` prevents duplicates — second INSERT is a no-op (or caught by upsert)
- **Hash computation fails**: Log warning, write event with `content_hash = NULL` (non-blocking)
- **Provider returns different field names for same semantic**: Normalization mapping handles this per-provider

---

## Alternative Designs Considered

### Alternative 1: Single JSONB column with all three layers
- **Pros**: Simpler schema
- **Cons**: Can't index individual layers, harder to query, loses the explicit boundary
- **Decision**: Not chosen — three separate JSONB columns enforce the layering

### Alternative 2: Content-addressing via MD5
- **Pros**: Faster, shorter hash
- **Cons**: Collision risk, not suitable for integrity verification
- **Decision**: Not chosen — SHA-256 is the standard for content-addressing

### Alternative 3: Event bus (Kafka/RabbitMQ) for async writes
- **Pros**: Decouples write path, better throughput
- **Cons**: Adds infrastructure complexity, not needed at current scale
- **Decision**: Not chosen — PostgreSQL synchronous writes are sufficient

---

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-76 | Distributed tracing / OpenTelemetry spans | Observability | bp-110-distributed-tracing | ☐ |
| 2 | bp-106 | Log aggregation transport | Observability | bp-106-log-aggregation | ☐ |
| 3 | bp-101 | Configurable log rotation | Developer experience | bp-101-configurable-log-rotation | ☐ |
| 4 | bp-78 | CSP DB ingestion gap | Observability | bp-111-csp-db-ingestion | ☐ |
| 5 | bp-78 | CSP router mount | Bug fix | bp-112-csp-router-mount | ☐ |
| 6 | bp-78 | CSP cleanup scheduling | Bug fix | bp-113-csp-cleanup-schedule | ☐ |

---

## Specification Generation

If a small model (7B–34B) will execute this ticket, distill into `04_SPECIFICATION.md`.

- [ ] `04_SPECIFICATION.md` has been created with exact file operations
- [ ] Test expectations are specific
- [ ] Edge cases are enumerated explicitly
- [ ] Imports and dependencies are listed per file
- [ ] **Pending scope items presented to user**: All deferred improvements listed above

---

*This design document guides implementation. The three-layer payload structure is the core architectural decision — it must be enforced in the schema and validated in code.*
