# 01_ARCHITECT_REQUIREMENT.md — Structured Telemetry Events (Three-Layer Canonical Payload)

**Status**: planned
**Date created**: 2026-07-27
**Date completed**: TBD
**Author**: AI Assistant
**Scope**: Backend
**Priority**: P2
**Effort**: Large

---

## Requirement

The current telemetry system (`usage_logs` table) stores AI usage data in a flat schema with a loosely-structured `metadata` JSONB column. This creates several problems:

1. **No normalization boundary** — Provider-specific fields (Claude's `input_tokens` vs OpenAI's `prompt_tokens`) are silently normalized at write time with no record of what the provider actually reported.
2. **No schema versioning** — If the event shape changes, existing queries break silently. There's no way to know which version of the event schema a row conforms to.
3. **No field provenance** — When a field appears in `usage_logs`, there's no record of whether it came directly from the provider, was normalized by the backend, or was derived (e.g., `cost_usd`).
4. **No content-addressing** — Events can't be deduplicated or verified by content hash. A signature over an event preserves ambiguity rather than removing it.

This ticket introduces a **structured telemetry event schema** with three explicit layers in the canonical payload, schema versioning, normalization rules, field provenance, and content-addressing via SHA-256 hashing.

**Design directive** (from code review):
> "Operational visibility is the right first boundary. If the telemetry becomes a content-addressed VTO, I would keep three layers explicit in the canonical payload: raw provider-reported fields, normalized fields, and derived metrics. The schema version, normalization rule, and provenance of each field need to travel with the event; otherwise a signature can preserve an ambiguity rather than remove it."

---

## Existing Infrastructure Audit

### Backend API Check
- [x] API route exists: `backend/src/api/usage.js` — YES (GET project usage, GET user usage, POST agent usage)
- [x] Controller exists: `backend/src/controllers/usageController.js` — YES
- [x] Service exists: `backend/src/services/UsageLogger.js` — YES
- [x] Model exists: N/A (usage_logs is accessed directly via pool queries)
- [x] Validator exists: N/A (agent usage validation is inline in UsageLogger.reportUsage)
- [x] Route is mounted: `backend/src/api/v1/index.js` — YES (usage routes at /usage/*)
- [x] OpenAPI JSDoc annotations exist: `backend/src/api/openapi-metrics.js` — YES (for /metrics only)

### Frontend API Client Check
- [x] API client exists: `frontend/src/api/usage.js` — YES (fetchProjectUsage, fetchUserUsage, fetchModelPricing)
- [x] API client functions cover all needed endpoints — YES (no new endpoints needed)
- [x] API client follows existing patterns — YES

### Frontend UI Check
- [x] View component exists: `frontend/src/views/TicketDetail.vue` — YES (shows usage breakdown table)
- [ ] No new UI needed — this is a backend-only structural change

### Integration Check
- [x] Frontend API client can call existing backend endpoints — YES
- [x] Response shapes match — YES (no API shape changes)
- [x] Auth tokens are used correctly — YES
- [x] Error handling matches existing patterns — YES

### Key Insight

**This is a BACKEND-ONLY task.** The frontend already consumes usage data through existing API endpoints. The change is internal to how the backend stores and structures telemetry events. No API response shapes change. No frontend code needs modification.

---

## Scope

### In Scope
- Create `telemetry_events` table with three-layer JSONB payload structure
- Add `schema_version`, `normalization_rule`, `field_provenance` metadata per event
- Add content-addressing via SHA-256 hash of the canonical event payload
- Update `UsageLogger.log()` and `UsageLogger.reportUsage()` to write to the new table
- Update all three providers (Claude, OpenAI, Generic) to emit raw provider fields
- Add content-hash index for deduplication and verification
- Maintain backward compatibility: `usage_logs` continues to work (dual-write during transition)
- Migration with rollback

### Out of Scope
- **Frontend changes** — No UI changes needed
- **Removing `usage_logs`** — The old table remains for backward compatibility; removal is a future ticket
- **Distributed tracing / OpenTelemetry** — Not in this ticket
- **Event bus / streaming** — Events are still written synchronously to PostgreSQL
- **Cryptographic signing of events** — The schema supports it (content-addressing), but actual signing is deferred
- **Read-side aggregation changes** — `getProjectUsage`, `getUserUsage`, `getTotalUsage` continue reading from `usage_logs`

---

## Pending Scope Items to Present to User

**MANDATORY**: Before presenting this ticket to the user, list all deferred improvements found in previous tickets' "Out of Scope" sections that are relevant to this ticket's domain.

### Items to Present

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-76 | Distributed tracing / OpenTelemetry spans | Observability | bp-110-distributed-tracing | ☐ |
| 2 | bp-106 | Winston transport for log aggregation (Datadog/CloudWatch) | Observability | bp-106-log-aggregation | ☐ |
| 3 | bp-101 | Log rotation settings configurable via env vars | Developer experience | bp-101-configurable-log-rotation | ☐ |
| 4 | bp-78 | CSP report ingestion to DB (POST /csp-report only logs, doesn't write to csp_violations) | Observability | bp-111-csp-db-ingestion | ☐ |
| 5 | bp-78 | CSP violations router not mounted in v1/index.js | Bug fix | bp-112-csp-router-mount | ☐ |
| 6 | bp-78 | CSP cleanup service not scheduled | Bug fix | bp-113-csp-cleanup-schedule | ☐ |

---

## Deferred Improvements Found (Internal Tracking)

| # | From Ticket | Improvement | Category | Suggested Next Ticket |
|---|-------------|-------------|----------|----------------------|
| 1 | bp-76 | Distributed tracing / OpenTelemetry spans | Observability | bp-110-distributed-tracing |
| 2 | bp-106 | Log aggregation transport | Observability | bp-106-log-aggregation |
| 3 | bp-101 | Configurable log rotation | Developer experience | bp-101-configurable-log-rotation |
| 4 | bp-78 | CSP DB ingestion gap | Observability | bp-111-csp-db-ingestion |
| 5 | bp-78 | CSP router mount | Bug fix | bp-112-csp-router-mount |
| 6 | bp-78 | CSP cleanup scheduling | Bug fix | bp-113-csp-cleanup-schedule |

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/services/UsageLogger.js` | MODIFY | Add dual-write to `telemetry_events` with three-layer payload |
| `backend/src/providers/claude/index.js` | MODIFY | Capture raw provider response fields |
| `backend/src/providers/openai/index.js` | MODIFY | Capture raw provider response fields |
| `backend/src/providers/generic/index.js` | MODIFY | Capture raw provider response fields |
| `backend/src/migrations/040_telemetry_events.sql` | CREATE | New table with structured JSONB payload |
| `backend/src/services/EventHashService.js` | CREATE | Content-addressing via SHA-256 |
| `backend/src/__tests__/telemetryEvents.test.js` | CREATE | Unit tests for new schema and hashing |
| `database` | NEW MIGRATION | `telemetry_events` table |
| `config` | NONE | No new env vars needed |

---

## Known Unknowns

1. **Dual-write duration**: How long should `usage_logs` and `telemetry_events` coexist before `usage_logs` is deprecated? Decision: Keep both indefinitely in this ticket; removal is a separate ticket.
2. **Hash collision risk**: SHA-256 has negligible collision risk for this use case, but should we store the full payload alongside the hash for verification? Decision: Yes, store the full canonical payload in `canonical_payload` JSONB.
3. **Generic provider raw fields**: The generic provider may return OpenAI-compatible or non-standard fields. How do we handle unknown fields? Decision: Store them in `raw_provider_fields` as-is under an `additional` sub-key.

---

## Important Design Decisions

**DECISION POINTS** — Items that need user confirmation.

1. **Dual-write strategy**: Write to both `usage_logs` and `telemetry_events` simultaneously, or migrate reads first? **Recommendation**: Dual-write — `usage_logs` remains the source of truth for existing queries; `telemetry_events` is the new canonical store.
2. **Schema versioning approach**: Use a `schema_version` integer column (simple) or a semver string (more expressive)? **Recommendation**: Integer (1, 2, 3...) — simpler, sufficient for this use case, easier to index.

---

## Acceptance Criteria

1. [ ] [Backend DB] `telemetry_events` table created with correct schema (three-layer JSONB, schema_version, content_hash, field_provenance)
2. [ ] [Backend DB] Content-hash index on `content_hash` column for fast deduplication
3. [ ] [Backend Service] `UsageLogger.log()` writes to both `usage_logs` and `telemetry_events`
4. [ ] [Backend Service] `UsageLogger.reportUsage()` writes to both tables
5. [ ] [Backend Service] `UsageLogger.logPlanningUsage()` writes to both tables
6. [ ] [Backend Service] `EventHashService.computeHash()` produces deterministic SHA-256 of canonical payload
7. [ ] [Backend Provider] Claude provider captures raw `response.usage` fields
8. [ ] [Backend Provider] OpenAI provider captures raw `response.usage` fields
9. [ ] [Backend Provider] Generic provider captures raw `response.data.usage` fields
10. [ ] [Backend Tests] Unit tests for EventHashService (determinism, different inputs → different hashes)
11. [ ] [Backend Tests] Unit tests for three-layer payload construction
12. [ ] [Backend Tests] Unit tests for UsageLogger dual-write
13. [ ] [Backend Tests] All existing usage tests still pass
14. [ ] [Backend Tests] Coverage threshold enforced (60%)
15. [ ] [Backend Migration] Migration has both up and rollback SQL
16. [ ] [Backend Migration] Migration applied in correct position in `apply.js`

---

## Out of Scope

- Removing `usage_logs` table (future ticket)
- Frontend changes (no API shape changes)
- Distributed tracing / OpenTelemetry
- Event bus / streaming architecture
- Cryptographic signing of events
- Read-side aggregation from `telemetry_events` (future ticket)
- CSP ingestion gap fixes (separate tickets)
- Log aggregation transport (separate ticket)

---

## Performance Considerations

- Expected load: ~100-500 AI calls/day (current usage pattern)
- N+1 queries to avoid: The dual-write adds one INSERT per AI call — negligible at current scale
- Caching strategy: None needed (write-path only)
- Pagination needed: N/A (write-path only; reads still use `usage_logs` aggregation)
- **Hash computation**: SHA-256 of a ~500-byte JSON payload takes <1ms — negligible

---

## Security Considerations

- [x] Authentication required: NO — usage logging happens server-side after authenticated AI calls
- [x] Authorization check: N/A — internal write-path
- [x] Input validation: YES — provider raw fields must be sanitized before JSONB insertion
- [x] Rate limiting: N/A — internal write-path
- [x] Sensitive data handling: YES — raw provider fields may contain prompt content; ensure `metadata` column in `usage_logs` (which may contain prompts) is not exposed without auth

---

## Testing Checklist

### Backend Tests
- [ ] Unit test files CREATED for EventHashService: `backend/src/__tests__/eventHashService.test.js`
- [ ] Unit test files CREATED for telemetry event payload: `backend/src/__tests__/telemetryEvents.test.js`
- [ ] Existing usage tests: `backend/src/__tests__/usageLogger.test.js` — EXTENDED with dual-write tests
- [ ] Happy path AND error paths tested (not just happy path)
- [ ] Edge case: provider returns empty/null usage object
- [ ] Edge case: provider returns unknown extra fields
- [ ] Edge case: same input produces identical content hash (determinism)
- [ ] Edge case: different input produces different content hash
- [ ] **Coverage threshold (60%)**: `npm run test:coverage` — must pass

### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run test:coverage` — backend coverage threshold passes (60%)
- [ ] `npm run lint` — no lint errors
- [ ] `npm run db:migrate` — migration applies cleanly
- [ ] Rollback SQL reverts cleanly

---

## Anti-Patterns to Avoid

- ❌ **Removing `usage_logs` reads** — existing aggregation queries must continue working
- ❌ **Storing raw provider response as a blob** — must be structured with known keys per provider
- ❌ **Hashing non-deterministic JSON** — canonical payload must be deterministically serialized (sorted keys, no whitespace)
- ❌ **Skipping backward compatibility** — dual-write ensures zero downtime
- ❌ **Hardcoding provider field names** — use a normalization mapping that can evolve per provider
- ❌ **Ignoring the generic provider** — it may return non-standard fields; handle via `additional` sub-key

---

*Fill in all sections before starting implementation. The three-layer payload structure is the most critical design decision — it must be explicit in the schema and enforced in code.*
