# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: draft
**Date created**: 2026-07-23
**Author**: AI Assistant
**Scope**: Backend | Java Agent | Frontend
**Priority**: P2
**Effort**: Medium

---

## Requirement

bp-04 wired usage tracking to **agent AI calls** (code generation), but **planning-stage AI calls** are not tracked with per-stage granularity. When an AI agent processes a ticket, it:

1. Fetches planning docs (00-04 templates)
2. Calls the LLM with planning docs + repo context to generate code
3. Reports usage back to backend — but only with `ticket_id`, no stage context

In real workloads, customers need to know **where their AI spend goes**:
- How much did requirement extraction cost?
- How much did plan generation cost?
- How much did refinement cost?
- How much did validation cost?

The feedback from PR #66 states: *"I would attach usage to the planning object itself: requirement extraction, plan generation, refinement, and validation. That makes billing and customer-facing explanations much easier."*

This ticket tracks AI usage at the **planning document level**, so each planning file (00_ARCHITECT_CHECKLIST.md, 01_ARCHITECT_REQUIREMENT.md, etc.) carries its own usage metadata, and the system can answer "how much did it cost to process this planning stage?"

---

## Existing Infrastructure Audit

### Backend API Check
- [x] `UsageLogger.js` — `log()`, `reportUsage()`, `getProjectUsage()`, `getUserUsage()` exist
- [x] `BillingService.js` — `aggregateDailyBilling()`, `getProjectBilling()`, `getUsageSince()` exist
- [x] `pricing.js` — `MODEL_PRICING` map + `calculateCost()` exist
- [x] `usage_logs` table — has `ticket_id`, `agent_id`, `provider_type`, `model`, `tokens_in`, `tokens_out`, `cost_usd`, `duration_ms`
- [x] `POST /api/v1/agents/:agentId/usage` — agent usage reporting endpoint exists (from bp-04)
- [x] `ticket_planning` table — versioned markdown per ticket
- [ ] **Missing**: `ticket_planning` has no usage columns
- [ ] **Missing**: `usage_logs` has no `planning_stage` or `file_key` columns
- [ ] **Missing**: API endpoint for per-planning-file usage history
- [ ] **Missing**: Frontend usage display in planning viewer

### Java Agent Check
- [x] `TicketProcessor.generateContent()` — calls AI, reports usage with `ticket_id`
- [x] `ApiService.reportUsage()` — POSTs usage to backend
- [x] `AiProvider.getTokensIn/getTokensOut` — expose token counts
- [ ] **Missing**: Agent reports usage per planning stage (not just ticket-level)
- [ ] **Missing**: Agent tracks which planning files it consumed per AI call

### Frontend Check
- [x] Planning file viewer in `frontend/src/views/` — displays planning documents
- [x] `TicketDetail` view — shows planning status, file list
- [ ] **Missing**: Usage indicators on planning files (cost, tokens, duration)
- [ ] **Missing**: Per-stage usage breakdown view

### Key Insight

This is a **backend API + database migration + Java agent + frontend** task. The core change:
1. Add usage columns to `ticket_planning` (last-known usage per file) for customer-facing explanations
2. Add `planning_stage` and `file_key` to `usage_logs` for full history and billing
3. Java agent reports usage with planning context when it processes planning docs
4. Frontend displays usage data alongside planning files

---

## Scope

### In Scope
- [ ] Database: Add usage columns to `ticket_planning` table (`tokens_in`, `tokens_out`, `cost_usd`, `duration_ms`, `provider_type`, `model`, `planning_stage`, `last_ai_call_at`)
- [ ] Database: Add `planning_stage` and `file_key` columns to `usage_logs` table
- [ ] Backend: `UsageLogger.logPlanningUsage()` — new method to log usage with planning context
- [ ] Backend: `GET /tickets/:ticketId/planning/:fileKey/usage` — returns usage history for a planning file
- [ ] Backend: `GET /tickets/:ticketId/planning/usage` — returns aggregated usage across all planning files for a ticket
- [ ] Backend: `UsageLogger.log()` extended to accept optional `planning_stage` and `file_key`
- [ ] Java Agent: `TicketProcessor` reports usage with `planning_stage` context (e.g., "requirement_extraction", "plan_generation", "refinement", "validation")
- [ ] Java Agent: `ApiService.reportUsage()` extended to accept `planning_stage` and `file_key`
- [ ] Frontend: Display usage metadata (tokens, cost, duration) on planning files in the viewer
- [ ] Frontend: Usage breakdown per planning stage on ticket detail page

### Out of Scope
- [ ] Real-time cost estimation before AI calls
- [ ] Budget alerts or spending caps
- [ ] Per-model cost optimization recommendations
- [ ] Multi-tenant cost allocation (beyond project-level)
- [ ] Export usage data to CSV/PDF
- [ ] Historical cost trending/charts
- [ ] Invoice generation from planning usage

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

## Deferred Improvements Found (Internal Tracking)

| Item | Category | Priority |
|------|----------|----------|
| bp-75: Log file rotation | Infrastructure | P3 |
| bp-78: CSP violation reporting dashboard | Security | P2 |
| bp-79: Migration dry-run mode | Developer experience | P2 |
| bp-80: PgBouncer deployment | Infrastructure | P2 |
| bp-81: Agent bug fixes | Stability | unspecified |

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/migrations/038_planning_usage_columns.sql` | CREATE | Add usage columns to `ticket_planning` and `usage_logs` |
| `backend/src/migrations/038_planning_usage_columns_rollback.sql` | CREATE | Rollback migration |
| `backend/src/migrations/apply.js` | MODIFY | Add 038 to SQL_FILES array |
| `backend/src/services/UsageLogger.js` | MODIFY | Extend `log()` with planning_stage/file_key params; add `logPlanningUsage()` |
| `backend/src/services/TicketPlanningService.js` | MODIFY | Return usage data in list/get responses |
| `backend/src/api/ticketPlanning.js` | MODIFY | Add usage endpoints |
| `agent/.../service/TicketProcessor.java` | MODIFY | Report usage with planning_stage context |
| `agent/.../service/ApiService.java` | MODIFY | Extend reportUsage() with planning_stage, file_key |
| `frontend/src/views/TicketDetail.vue` (or equivalent) | MODIFY | Display usage breakdown per planning stage |
| `frontend/src/views/PlanningViewer.vue` (or equivalent) | MODIFY | Show usage metadata on planning files |

---

## Known Unknowns

1. **Planning stage detection**: The Java agent currently makes one AI call per ticket. To track per-stage usage, we need to either: (a) make separate AI calls per planning stage, or (b) infer stages from which planning files were read. Option (a) is more accurate but more expensive. Option (b) is cheaper but less precise.

2. **Usage attachment strategy**: "Attach usage to the planning object itself" could mean: (a) store last-known usage on each `ticket_planning` row, or (b) store full history in a separate table, or (c) both. The feedback suggests (a) for customer-facing simplicity, but (b) is needed for billing accuracy.

3. **When does the agent call AI during planning?**: Currently the agent fetches planning docs then makes ONE AI call to generate code. Planning-stage AI calls would be a different workflow — likely the human-facing AI assistant that helps fill in planning templates. We need to clarify whether this feature tracks: (a) agent code-generation calls tagged by which planning docs were consumed, or (b) human-facing AI calls that generate/refine planning content.

---

## Important Design Decisions

**DECISION 1 — Planning stage granularity:**

Option A: Track usage per planning file (01_ARCHITECT_REQUIREMENT.md, 02_ARCHITECT_DESIGN.md, etc.)
- Pros: Granular, maps to customer's planning documents
- Cons: Many small entries, harder to aggregate

Option B: Track usage per planning stage (requirement_extraction, plan_generation, refinement, validation)
- Pros: Aligns with feedback language, easier to summarize
- Cons: One stage may touch multiple files

**Recommendation**: Option B (stages) with `file_key` as optional secondary dimension. The feedback says "requirement extraction, plan generation, refinement, and validation" — these are stages, not files. Each stage can reference which files it touched via `file_key`.

**DECISION 2 — Usage storage:**

Option A: Only `planning_usage_logs` table (full history)
- Pros: Clean separation, easy to query history
- Cons: Doesn't satisfy "attach usage to the planning object itself"

Option B: Both `ticket_planning` (last-known) + `planning_usage_logs` (history)
- Pros: Satisfies both requirements; last-known for quick display, history for billing
- Cons: More complex, two tables to maintain

**Recommendation**: Option B. `ticket_planning` gets `last_tokens_in`, `last_tokens_out`, `last_cost_usd`, `last_planning_stage`, `last_ai_call_at` for quick display. `planning_usage_logs` gets full history for billing.

**DECISION 3 — What triggers planning-stage usage tracking:**

Option A: Agent reports usage when it consumes planning docs during ticket processing
- Pros: Reuses existing agent flow, no new infrastructure
- Cons: All usage attributed to one stage (code_generation), not per-file

Option B: Separate AI calls per planning stage (human-facing AI assistant)
- Pros: Accurate per-stage attribution
- Cons: Requires new AI workflow, more API calls

Option C: Hybrid — agent reports which planning files it read + which stage it's in
- Pros: Best of both worlds, works with existing flow
- Cons: Requires agent to track file consumption

**Recommendation**: Option C. The agent already reads planning docs. We extend it to report: `planning_stage` (the stage it's working in) + `file_keys` (array of planning files it consumed). This gives per-stage attribution with minimal changes.

---

## Acceptance Criteria

1. [ ] [DB] `ticket_planning` has usage columns: `last_tokens_in`, `last_tokens_out`, `last_cost_usd`, `last_duration_ms`, `last_provider_type`, `last_model`, `last_planning_stage`, `last_ai_call_at`
2. [ ] [DB] `usage_logs` has `planning_stage` and `file_key` columns
3. [ ] [Backend] `UsageLogger.log()` accepts optional `planning_stage` and `file_key`
4. [ ] [Backend] `GET /tickets/:ticketId/planning/:fileKey/usage` returns usage history for a file
5. [ ] [Backend] `GET /tickets/:ticketId/planning/usage` returns aggregated per-stage usage
6. [ ] [Backend] Planning file list includes last-known usage metadata
7. [ ] [Java Agent] `TicketProcessor` reports usage with `planning_stage` and `file_keys`
8. [ ] [Java Agent] `ApiService.reportUsage()` accepts and forwards planning context
9. [ ] [Frontend] Planning viewer shows usage indicators (tokens, cost, duration) per file
10. [ ] [Frontend] Ticket detail shows usage breakdown by planning stage
11. [ ] [Tests] Backend unit tests for new usage columns
12. [ ] [Tests] Backend integration tests for usage endpoints
13. [ ] [Tests] Java agent usage reporting with planning context
14. [ ] [Coverage] 60% minimum across all new/modified files

---

## Out of Scope

- Real-time cost estimation before AI calls
- Budget alerts or spending caps
- Per-model cost optimization recommendations
- Multi-tenant cost allocation
- Export usage data to CSV/PDF
- Historical cost trending/charts
- Invoice generation from planning usage

---

## Performance Considerations

- Usage columns on `ticket_planning` are updated only when AI calls are made, not on every planning file edit
- `planning_usage_logs` queries should use indexes on `ticket_id`, `file_key`, and `created_at`
- Aggregated usage endpoint should cache per-ticket results (TTL: 60s)
- Frontend usage display is read-only, no write path performance impact

---

## Security Considerations

- Usage data is project-scoped — users can only see usage for their projects
- Cost data should not be exposed to `user` role (only `member`+)
- `planning_stage` values are controlled enum — no user input
- `file_key` values are validated against known planning file keys

---

## Testing Checklist

### Backend Tests
- [ ] `UsageLogger.log()` with `planning_stage` and `file_key` inserts correctly
- [ ] `GET /tickets/:ticketId/planning/:fileKey/usage` returns correct history
- [ ] `GET /tickets/:ticketId/planning/usage` returns correct aggregation
- [ ] Planning file list includes usage metadata
- [ ] Permission checks: `user` role cannot see cost data
- [ ] Migration rollback works

### Java Agent Tests
- [ ] Agent reports usage with `planning_stage` context
- [ ] Agent reports `file_keys` array
- [ ] Usage reporting failure doesn't break ticket processing

### Frontend Tests
- [ ] Usage display component renders with correct data
- [ ] Usage breakdown component shows per-stage totals
- [ ] Empty usage state renders correctly (no usage yet)

### Integration Tests
- [ ] Full flow: agent processes ticket → usage logged per stage → API returns breakdown
- [ ] Bash integration: curl against Docker containers with real PG

---

## Anti-Patterns to Avoid

- ❌ **Storing cost in the agent** — always calculate cost server-side using `MODEL_PRICING`
- ❌ **Duplicating usage columns** — `ticket_planning` gets last-known only; history in `planning_usage_logs`
- ❌ **Hardcoding planning stage names** — use a controlled enum
- ❌ **Skipping the `file_key` dimension** — feedback specifically mentions attaching to the "planning object"
- ❌ **Creating new billing tables** — reuse `usage_logs` and `project_billing`
- ❌ **Ignoring backward compatibility** — new columns must be nullable for existing data
- ❌ **Testing only happy paths** — test missing usage data, empty history, permission denials

---

*Fill in all sections before starting implementation.*
