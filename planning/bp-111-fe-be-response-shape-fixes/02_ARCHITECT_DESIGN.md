# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Frontend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, `04_SPECIFICATION.md`

---

## Problem Statement

The frontend reads or types 5 pieces of API data incorrectly while the backend is correct. This produces visible zeros (usage breakdown, billing), silently drops the PR description, and leaves TS interfaces that don't match the wire. Fixing the frontend to match the verified backend contract is low-risk and high-value.

---

## Current State

### Existing Backend (source of truth — NOT changed)
- `GET /api/v1/usage/projects/:id/usage` → `{ success, data: { breakdown: [ { provider_type, model, total_in, total_out, total_cost, total_calls } ], totals: { totalTokensIn, totalTokensOut, totalCost, totalCalls } } }` (`UsageLogger.js:145-155`, `usageController.js:22`)
- `GET /api/v1/billing/projects/:id/billing` → `{ success, data: <array> }`; no-filter fallback rows `{ provider_type, model, total_in, total_out, total_cost, total_calls }` (`billingController.js:23-26`, `BillingService.getUsageSince`)
- `POST /api/v1/github/:ticketId/pr` reads `{ description, projectId }`; `createTicketPR` uses `ticket.title`/`ticket.branchName` from DB + `description || ticket.description` (`githubController.js:58`, `GitHubService.js:104-120`)
- `GET /api/v1/tickets/:id/phases/current` → `{ phase }`; `/allowed` → `{ allowed }`; `POST /transition` → `{ ticketId, fromPhase, toPhase, status }` (`tickets.js:306,330,372`)
- `POST /api/v1/projects/:id/templates` reads `{ name, description, file_definitions }` (`templateController.js:23`)

### Existing Frontend (the bug)
- `ProjectDetail.vue:241-244` breakdown `<td>` reads `model.calls`/`model.tokens_in`/`model.tokens_out`/`model.cost`; `usage.ts` `Usage` interface declares `input_tokens/output_tokens/total_tokens/cost`
- `billing.ts:13-14` `getProjectBilling` typed `Billing | null`; `useUsage.ts:31` `billing.value = result ? [result] : []` → nested array; `Billing` interface declares `total_cost_usd/total_tokens_in/total_tokens_out`
- `github.ts:56` `createPR` sends `{ title, body, branchName }`; view passes 4 args
- `phases.ts` `fetchPhases`→`Phase[]`, `fetchAllowedPhases`→`AllowedPhase[]`, `transitionPhase`→`Phase`
- `templates.ts` `createTemplate` signature `{ name, content, type }`; `Template` has `content`/`type`

### Gap Analysis
- Backend is correct for all 5; frontend reads/types wrong → **FRONTEND-ONLY fixes**

---

## Design

### Option A: Extend Existing Structure (Recommended)

Every fix modifies an existing file; no new production files. Respect `extractData` (unwraps one `.data` level).

**R1 — Usage breakdown**
- `ProjectDetail.vue:241-244`: change `<td>` reads to `model.total_in`, `model.total_out`, `model.total_cost`, `model.total_calls` (key stays `model.model`)
- `usage.ts` `Usage` interface: replace with breakdown shape `{ provider_type?, model, total_in, total_out, total_cost, total_calls }`. Keep `UsageResponse`/`UsageTotals` (already camelCase totals, correct).

**R2 — Billing array + shape**
- `billing.ts`: `getProjectBilling(projectId)` → `Promise<Billing[] | null>`; `Billing` interface → `{ provider_type: string; model: string; total_cost: number; total_in: number; total_out: number; total_calls: number; billing_month?: string }` (fallback shape; billing-table fields optional)
- `useUsage.ts:31`: `billing.value = result ?? []` (no `[result]` re-wrap)
- `ProjectDetail.vue` billing template already reads `row.total_cost`/`row.provider_type`/`row.model` (line 258 reduce + `v-for` rows) — matches fallback shape; no template change needed

**R3 — PR description**
- `github.ts`: `createPR(ticketId: string, description: string, projectId?: string): Promise<PullRequest>` sends `{ description, projectId }`. `title`/`branchName` args removed (backend derives both from the ticket DB row).
- `GitHubConnections.vue:138`: `await createPR(prTicketId.value.trim(), prBody.value.trim())`. Keep the `prTitle`/`prBranchName` inputs and the submit guard (line 133) as UX; they are no longer sent. Document that backend derives title/branch from the ticket (deferred UX cleanup).

**R4 — Phase typing**
- `phases.ts`: `fetchPhases` → `Promise<{ phase: string }>`; `fetchAllowedPhases` → `Promise<{ allowed: AllowedPhase[] }>`; `transitionPhase` → `Promise<{ ticketId: string; fromPhase: string; toPhase: string; status: string }>`. `PhaseFlow.vue` already reads `.phase`/`.allowed` correctly — no view change.
- Keep `Phase`/`AllowedPhase` interfaces (history/allowed shapes).

**R5 — Templates typing**
- `templates.ts`: `createTemplate(projectId, data: { name: string; description?: string; file_definitions: { key: string; content: string }[] })`; `updateTemplate` similarly `Partial<...>`; `Template` interface → `{ id, name, project_id, description, file_definitions, created_at, updated_at }`. Views (`ProjectTemplates.vue`) already send `file_definitions` — runtime OK; this only fixes the type contract.

### Option B: Change the backend — REJECTED
The backend shapes are correct and consumed by other clients (Java agents, bash integration suite). Changing the backend would break those and add scope. Not chosen.

### Option C: Create a normalization layer in `client.ts` — REJECTED
Adding a global snake_case→camelCase transform would be invasive and risk regressions across all 20 API modules. Not chosen.

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `frontend/src/views/ProjectDetail.vue` | MODIFY (R1) | Breakdown `<td>` reads `total_in`/`total_out`/`total_cost`/`total_calls` |
| `frontend/src/api/usage.ts` | MODIFY (R1) | `Usage` interface → breakdown shape |
| `frontend/src/api/billing.ts` | MODIFY (R2) | `getProjectBilling` → `Billing[]`; `Billing` interface → fallback shape |
| `frontend/src/composables/useUsage.ts` | MODIFY (R2) | `loadBilling` assigns `result ?? []` (no re-wrap) |
| `frontend/src/api/github.ts` | MODIFY (R3) | `createPR` → `(ticketId, description, projectId?)` sends `{ description }` |
| `frontend/src/views/GitHubConnections.vue` | MODIFY (R3) | Call `createPR(prTicketId, prBody)` |
| `frontend/src/api/phases.ts` | MODIFY (R4) | Correct return types for 3 functions |
| `frontend/src/api/templates.ts` | MODIFY (R5) | `createTemplate`/`updateTemplate` signature + `Template` interface |
| Migration | NONE | No DB change |
| `backend` | NONE | No backend change |

---

## Data Flow Diagram

```
[User] → [ProjectDetail.vue] → [usage.ts/billing.ts] → [GET /api/v1/usage... | /billing...] → [usageController|billingController]
[User] → [GitHubConnections.vue] → [github.ts createPR] → [POST /api/v1/github/:id/pr {description}] → [GitHubService.createTicketPR]
[User] → [PhaseFlow.vue] → [phases.ts] → [GET /phases/current|allowed, POST /transition] → [phaseService]
```

### Frontend Data Flow
1. Component calls API client
2. Client sends HTTP request with auth token
3. `extractData` unwraps one `.data` level → returns the inner shape
4. Component reads the (now-correct) fields

### Backend Data Flow (unchanged)
1. Route → middleware (verifyToken) → validator → controller → service → DB → `{ success, data }`

### Error Handling Strategy
No change — all fixes preserve existing `.catch(() => [])` / `.catch(() => null)` patterns and the global error handler.

---

## Dependencies

### Frontend Dependencies
- `frontend/src/api/client.ts` `get`/`post` + `extractData` semantics
- `frontend/src/composables/useUsage.ts` (R2)
- Views: `ProjectDetail.vue`, `GitHubConnections.vue`, `PhaseFlow.vue`, `ProjectTemplates.vue`

### Cross-Cutting Dependencies
- No OpenAPI spec change (backend untouched)
- No generated-type regeneration (hand-written clients are authoritative; fg-13 F6 handles generated drift)

---

## Config / Environment Changes

- [x] No new environment variables
- [x] No new database migrations
- [x] No new npm dependencies
- [x] No existing config changes

---

## Database Changes

None.

---

## Security Considerations

- [x] No new endpoints; existing auth/permissions unchanged
- [x] No new sensitive data handling
- [x] R3 sends only `description` (plain text), no credentials

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Frontend unit | Vitest | `frontend/src/__tests__/{usage,billing,github,phases,templates}.test.js` + `useUsage.test.ts` | Wrong field reads, wrong payload, wrong return type |

### Frontend-Backend Contract
- No backend response shape change → `api-contract.test.ts` and `validator.ts` unaffected

---

## Risks and Edge Cases

### Backend Risks
- None (backend untouched)

### Frontend Risks
- **[R2 shape ambiguity]**: billing returns different shapes by query. Mitigation: type to fallback shape (what the UI uses) with optional billing-table fields; verify `getUsageSince` during impl.
- **[R3 dead inputs]**: `prTitle`/`prBranchName` inputs become decorative. Mitigation: keep them gating submission; document the backend-derives-title/branch behavior; defer UI cleanup.

### Integration Risks
- **[R1 template]**: ensure the `<td>` key uses `model.model` and cells map to `total_in`/`total_out`/`total_cost`/`total_calls` exactly (no camelCase).

### Edge Cases
- Empty `usageData.breakdown`: `v-if="usageData?.breakdown && usageData.breakdown.length > 0"` already guards — no change
- Empty billing: `useUsage` sets `billing.value = []` → template `v-else-if="!usageBilling || usageBilling.length === 0"` shows empty state
- `createPR` with empty body: backend uses `description || ticket.description` fallback — safe to send empty/undefined

---

## Alternative Designs Considered

### Alternative 1: Change the backend to return camelCase
- **Pros**: matches a "frontend-first" convention
- **Cons**: breaks Java agents + bash integration suite that consume snake_case; larger blast radius
- **Decision**: Not chosen — backend is the shared contract

### Alternative 2: Global snake_case→camelCase transform in `client.ts`
- **Pros**: one central fix
- **Cons**: invasive, risks all 20 API modules, unclear mapping for mixed-shape objects (Provider mixes both)
- **Decision**: Not chosen — targeted fixes are safer

---

## Pending Scope Items to Present to User

**MANDATORY**: Before presenting this ticket to the user, list all deferred improvements found in previous tickets' "Out of Scope" sections that are relevant to this ticket's domain.

### Items to Present

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | R3 (this ticket) | `GitHubConnections.vue` PR form collects `prTitle`/`prBranchName` that the backend ignores (it derives both from the ticket DB row); form should drop or hide these inputs | UX | bp-XX-pr-form-cleanup | ☐ |
| 2 | fg-13 (F6) | Generated API client is stale/unused; regenerate or delete to prevent drift | Developer experience | fg-13 F6 | ☐ |
| 3 | fg-13 | `postWithHeaders` dead export in `client.ts` | Developer experience | bp-XX-dead-code-cleanup | ☐ |
| 4 | bp-80 | Route-mount drift audit tooling | Developer experience | bp-XX-route-mount-audit | ☐ |

**All items above must be presented to the user before ticket approval.**

---

## Specification Generation

If a small model (7B–34B) will execute this ticket, the information above should be distilled into `04_SPECIFICATION.md` — exact file paths, imports, function signatures, test expectations, edge cases. The small model should not need to make any architecture decisions.

- [x] `04_SPECIFICATION.md` has been created with exact file operations for each file
- [x] Test expectations are specific (assert exact field names/payloads)
- [x] Edge cases enumerated
- [x] Imports and dependencies listed per file
- [x] Pending scope items presented to user (above)

---

*This design document guides implementation. The "Extend Existing Structure" section is the most important — it tells the agent exactly how to add to what already exists rather than creating new code from scratch.*
