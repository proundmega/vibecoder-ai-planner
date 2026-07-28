## Ticket: bp-109 — Structured Telemetry Events (Three-Layer Canonical Payload)

**Status**: planned
**Priority**: P2
**Effort**: Large
**Author**: AI Assistant
**Date created**: 2026-07-27
**Date completed**: TBD
**PR**: TBD
**Branch**: TBD
**Scope**: Backend

**Dependencies**: None

---

### a) Purpose

Introduce a structured telemetry event schema with three explicit layers (raw provider-reported fields, normalized fields, derived metrics), schema versioning, field provenance, and content-addressing via SHA-256. This ensures that signed events preserve no ambiguity, and that the provenance of every field is traceable.

---

### b) Actions

**CRITICAL**: Before implementing, check if the feature can be added to existing code rather than creating new files.

#### Implementation Order

Steps must be executed in this exact order (dependencies between steps are noted):

1. **Create migration** — `backend/src/migrations/040_telemetry_events.sql` + rollback
   - Create `telemetry_events` table with three-layer JSONB columns
   - Add content_hash unique index
   - Add provider_model, project_id, created_at indexes
   - *Depends on*: nothing

2. **Update migration apply order** — `backend/src/migrations/apply.js`
   - Add `'040_telemetry_events.sql'` to SQL_FILES array
   - *Depends on*: Step 1

3. **Create EventHashService** — `backend/src/services/EventHashService.js`
   - `computeHash(payload)` — deterministic SHA-256 of canonical payload
   - `canonicalize(payload)` — sorted-key JSON.stringify
   - *Depends on*: nothing

4. **Update UsageLogger** — `backend/src/services/UsageLogger.js`
   - Add `logStructuredEvent()` method — constructs three-layer payload
   - Add normalization mapping per provider
   - Add provenance map construction
   - Dual-write in `log()`, `reportUsage()`, `logPlanningUsage()`
   - *Depends on*: Step 1, Step 3

5. **Update providers to capture raw fields** — `backend/src/providers/*/index.js`
   - Claude: capture full `response.usage` object
   - OpenAI: capture full `response.usage` object
   - Generic: capture full `response.data.usage` object
   - Pass raw fields to UsageLogger
   - *Depends on*: Step 4

6. **Create tests** — `backend/src/__tests__/eventHashService.test.js` + `telemetryEvents.test.js`
   - *Depends on*: Step 3, Step 4

7. **Extend existing tests** — `backend/src/__tests__/usageLogger.test.js`
   - Add dual-write test cases
   - *Depends on*: Step 4

#### Phase 1: Database Migration

1. Create migration: `backend/src/migrations/040_telemetry_events.sql`
   - Three-layer JSONB columns: `raw_provider_fields`, `normalized_fields`, `derived_metrics`
   - `field_provenance` JSONB
   - `schema_version` INTEGER DEFAULT 1
   - `content_hash` VARCHAR(64) UNIQUE NOT NULL
   - Context columns: `project_id`, `user_id`, `agent_id`, `ticket_id`, `planning_stage`, `file_key`, `duration_ms`
   - Indexes on content_hash, provider_type+model, project_id, created_at, agent_id, ticket_id

2. Create rollback: `backend/src/migrations/040_telemetry_events_rollback.sql`

3. Update: `backend/src/migrations/apply.js` — add to SQL_FILES array

#### Phase 2: EventHashService

1. Create: `backend/src/services/EventHashService.js`
   - `canonicalize(obj)` — deterministic JSON serialization (sorted keys, no whitespace)
   - `computeHash(payload)` — SHA-256 of canonical payload

#### Phase 3: UsageLogger Updates

1. Modify: `backend/src/services/UsageLogger.js`
   - Add `_buildRawProviderFields(providerType, rawUsage)` — normalizes raw provider response to known structure
   - Add `_buildNormalizedFields(providerType, rawUsage, durationMs)` — standardizes to tokens_in/tokens_out
   - Add `_buildDerivedMetrics(normalizedFields, model)` — computes cost_usd, tokens_per_second
   - Add `_buildFieldProvenance(providerType)` — returns provenance map
   - Add `logStructuredEvent(data)` — constructs three-layer payload, computes hash, INSERT into telemetry_events
   - Modify `log()` — add dual-write call to `logStructuredEvent()`
   - Modify `reportUsage()` — add dual-write call to `logStructuredEvent()`
   - Modify `logPlanningUsage()` — add dual-write call to `logStructuredEvent()`

#### Phase 4: Provider Raw Field Capture

1. Modify: `backend/src/providers/claude/index.js`
   - Pass raw `response.usage` object to UsageLogger (in addition to normalized usage)
   - Add `rawUsage` parameter to UsageLogger.log() call

2. Modify: `backend/src/providers/openai/index.js`
   - Pass raw `response.usage` object to UsageLogger

3. Modify: `backend/src/providers/generic/index.js`
   - Pass raw `response.data.usage` object to UsageLogger

#### Phase 5: Tests

1. Create: `backend/src/__tests__/eventHashService.test.js`
   - Determinism: same input → same hash
   - Different input → different hash
   - Sorted keys: {a:1, b:2} and {b:2, a:1} produce same hash
   - Empty object produces consistent hash
   - Null/undefined handling

2. Create: `backend/src/__tests__/telemetryEvents.test.js`
   - Three-layer payload construction for each provider type
   - Provenance map correctness
   - Derived metrics calculation (cost_usd, tokens_per_second)
   - Unknown fields in generic provider go to `additional` sub-key

3. Extend: `backend/src/__tests__/usageLogger.test.js`
   - Dual-write: log() writes to both tables
   - Dual-write: reportUsage() writes to both tables
   - Dual-write: logPlanningUsage() writes to both tables
   - Structured event has correct three-layer structure

---

### c) Per-File Action Plan

#### `backend/src/migrations/040_telemetry_events.sql` (CREATE)
- CREATE TABLE telemetry_events with all columns
- CREATE INDEX on content_hash, provider_type+model, project_id, created_at, agent_id, ticket_id
- UNIQUE constraint on content_hash

#### `backend/src/migrations/040_telemetry_events_rollback.sql` (CREATE)
- DROP TABLE IF EXISTS telemetry_events

#### `backend/src/migrations/apply.js` (MODIFY)
- Add `'040_telemetry_events.sql'` to SQL_FILES array (after 039)

#### `backend/src/services/EventHashService.js` (CREATE)
- **Exports**: `computeHash(payload)`, `canonicalize(payload)`
- **Logic**: canonicalize → SHA-256 → hex digest
- **Imports needed**: `const crypto = require('crypto')`

#### `backend/src/services/UsageLogger.js` (MODIFY)
- **Add method**: `_buildRawProviderFields(providerType, rawUsage)`
  - Claude: `{ input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens }`
  - OpenAI: `{ prompt_tokens, completion_tokens, total_tokens }`
  - Generic: `{ ...rawUsage, additional: { ...unknown fields } }`
- **Add method**: `_buildNormalizedFields(providerType, rawUsage, durationMs)`
  - Always: `{ tokens_in, tokens_out, tokens_total, duration_ms, provider_type, model }`
- **Add method**: `_buildDerivedMetrics(normalizedFields, model)`
  - Always: `{ cost_usd, tokens_per_second }`
  - `cost_usd`: from `calculateCost(model, tokens_in, tokens_out)`
  - `tokens_per_second`: `tokens_out / (duration_ms / 1000)` (guard div-by-zero)
- **Add method**: `_buildFieldProvenance(providerType)`
  - Returns provenance map based on provider type
- **Add method**: `logStructuredEvent({ providerType, model, rawUsage, durationMs, projectId, userId, agentId, ticketId, planningStage, fileKey })`
  - Builds three-layer payload using above methods
  - Computes content_hash via EventHashService
  - INSERT into telemetry_events (ON CONFLICT content_hash DO NOTHING)
- **Modify method**: `log()` — add `rawUsage` parameter, call `logStructuredEvent()` after existing INSERT
- **Modify method**: `reportUsage()` — add `rawUsage` from data, call `logStructuredEvent()`
- **Modify method**: `logPlanningUsage()` — add `rawUsage` from planData, call `logStructuredEvent()`

#### `backend/src/providers/claude/index.js` (MODIFY)
- **Modify**: `chat()` method — capture raw `response.usage` object
- Pass `rawUsage: response.usage` to `UsageLogger.log()`

#### `backend/src/providers/openai/index.js` (MODIFY)
- **Modify**: `chat()` method — capture raw `response.usage` object
- Pass `rawUsage: response.usage` to `UsageLogger.log()`

#### `backend/src/providers/generic/index.js` (MODIFY)
- **Modify**: `chat()` method — capture raw `response.data.usage` object
- Pass `rawUsage: response.data.usage` to `UsageLogger.log()`

---

### d) Dependencies

- `crypto` (Node.js built-in) — SHA-256 hashing
- `UsageLogger` — existing service to extend
- `pricing.js` — existing cost calculation
- All three providers — to capture raw fields

---

### e) Risks/Edge Cases

- **Dual-write latency**: ~1-5ms added per AI call. Negligible at current scale.
- **Provider returns null usage**: Fall back to zeros, log warning, still write event.
- **Generic provider unknown fields**: Store in `raw_provider_fields.additional`.
- **Hash collision**: SHA-256 collision risk is negligible. UNIQUE constraint catches any collision.
- **Hash computation failure**: Log warning, write event with `content_hash = NULL` (non-blocking).
- **Schema version evolution**: Old rows keep their version. Code must handle both versions.

---

### f) Testing

**MANDATORY: You must CREATE new test files or EXTEND existing test files for all new/changed code.**

#### Test-First Requirement

If `04_SPECIFICATION.md` exists, create empty test stubs before production code.

#### Backend Unit Tests
- [ ] Test EventHashService: `backend/src/__tests__/eventHashService.test.js` — CREATED
- [ ] Test telemetry payload: `backend/src/__tests__/telemetryEvents.test.js` — CREATED
- [ ] Test UsageLogger dual-write: `backend/src/__tests__/usageLogger.test.js` — EXTENDED
- [ ] Every new service method has at least one test case
- [ ] Happy path AND error paths tested
- [ ] **Coverage threshold (60%)**: `npm run test:coverage`

#### Backend Tests — Specific Cases
```
✓ [happy] log() writes to both usage_logs and telemetry_events
✓ [happy] reportUsage() writes to both tables
✓ [happy] logPlanningUsage() writes to both tables
✓ [happy] Three-layer payload has correct structure for Claude
✓ [happy] Three-layer payload has correct structure for OpenAI
✓ [happy] Three-layer payload has correct structure for Generic
✓ [happy] content_hash is deterministic (same input → same hash)
✓ [happy] different inputs produce different hashes
✓ [happy] sorted keys produce same hash regardless of key order
✓ [happy] cost_usd is correctly derived from model + tokens
✓ [happy] tokens_per_second is correctly derived
✓ [error] provider with null usage writes zeros
✓ [edge] generic provider unknown fields go to additional sub-key
✓ [edge] duplicate content_hash is ignored (ON CONFLICT DO NOTHING)
✓ [edge] tokens_per_second guards division by zero (duration_ms=0)
```

---

### g) Migration Notes

```sql
-- 040_telemetry_events.sql
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

CREATE INDEX idx_telemetry_events_content_hash ON telemetry_events(content_hash);
CREATE INDEX idx_telemetry_events_provider_model ON telemetry_events(provider_type, model);
CREATE INDEX idx_telemetry_events_project_id ON telemetry_events(project_id);
CREATE INDEX idx_telemetry_events_created_at ON telemetry_events(created_at);
CREATE INDEX idx_telemetry_events_agent_id ON telemetry_events(agent_id);
CREATE INDEX idx_telemetry_events_ticket_id ON telemetry_events(ticket_id);
```

- [ ] Migration file: `backend/src/migrations/040_telemetry_events.sql`
- [ ] Migration applied in correct position in `backend/src/migrations/apply.js`
- [ ] Rollback file: `backend/src/migrations/040_telemetry_events_rollback.sql`
- [ ] Rollback tested: can reverse without data loss

---

### h) Files Changed

**Backend:**
```
backend/src/migrations/040_telemetry_events.sql         → CREATE (migration)
backend/src/migrations/040_telemetry_events_rollback.sql → CREATE (rollback)
backend/src/migrations/apply.js                          → MODIFY (add to SQL_FILES)
backend/src/services/EventHashService.js                 → CREATE (content-addressing)
backend/src/services/UsageLogger.js                      → MODIFY (dual-write + three-layer)
backend/src/providers/claude/index.js                    → MODIFY (capture raw fields)
backend/src/providers/openai/index.js                    → MODIFY (capture raw fields)
backend/src/providers/generic/index.js                   → MODIFY (capture raw fields)
backend/src/__tests__/eventHashService.test.js           → CREATE (hash tests)
backend/src/__tests__/telemetryEvents.test.js            → CREATE (payload tests)
backend/src/__tests__/usageLogger.test.js                → MODIFY (dual-write tests)
```

**Frontend:**
```
(none — backend-only change)
```

---

### Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-76 | Distributed tracing / OpenTelemetry spans | Observability | bp-110-distributed-tracing | ☐ |
| 2 | bp-106 | Log aggregation transport | Observability | bp-106-log-aggregation | ☐ |
| 3 | bp-101 | Configurable log rotation | Developer experience | bp-101-configurable-log-rotation | ☐ |
| 4 | bp-78 | CSP DB ingestion gap | Observability | bp-111-csp-db-ingestion | ☐ |
| 5 | bp-78 | CSP router mount | Bug fix | bp-112-csp-router-mount | ☐ |
| 6 | bp-78 | CSP cleanup scheduling | Bug fix | bp-113-csp-cleanup-schedule | ☐ |

---

### i) Code Review Checklist

- [ ] Backend follows existing patterns (service method separation)
- [ ] Backend uses parameterized queries (no SQL injection)
- [ ] Backend response format unchanged (no API shape changes)
- [ ] Backend errors pass to `next(error)`
- [ ] Dual-write doesn't break existing `usage_logs` reads
- [ ] Content hash is deterministic (sorted keys, no whitespace)
- [ ] Three-layer structure is explicit in JSONB columns
- [ ] Field provenance is documented per provider
- [ ] All tests written and passing — new/changed code has corresponding test files CREATED or EXTENDED
- [ ] Migration has both up and rollback SQL
- [ ] **Coverage threshold enforced**: `npm run test:coverage` — min 60% lines, functions, branches, statements

---

### j) Post-Deploy Verification

1. [ ] Backend: `npm test` passes
2. [ ] Backend: `npm run test:coverage` passes (60% min threshold)
3. [ ] Backend: `npm run lint` passes
4. [ ] Backend: `npm run db:migrate` applies cleanly
5. [ ] Backend: Rollback SQL reverts cleanly
6. [ ] Existing usage queries still work (dual-write doesn't break reads)
7. [ ] New telemetry_events table has correct schema after migration

---

*Fill in all sections before starting implementation. Update status as work progresses.*
