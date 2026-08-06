# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Template

---

## Ticket: bp-111 — FE↔BE Response-Shape & Payload Fixes

**Status**: completed
**Priority**: P1
**Effort**: Small
**Author**: AI Assistant
**Date created**: 2026-08-06
**Date completed**: 2026-08-06
**PR**: (merged to master)
**Branch**: master
**Scope**: Frontend

**Dependencies**: none (independent of fg-13; backend untouched)

---

### a) Purpose

The frontend reads/types 5 API responses incorrectly while the backend is correct, producing zeroed usage/billing, a dropped PR description, and wrong TS interfaces. This ticket aligns the frontend to the verified backend contract. **FRONTEND-ONLY.**

---

### b) Actions

**CRITICAL**: All 5 fixes modify existing files; NO new production files. Backend is the source of truth and is NOT changed.

#### Implementation Order

Steps must be executed in this exact order (dependencies noted). Test stubs are created FIRST per `04_SPECIFICATION.md` Test-First Requirement.

0. **[Create test stubs]** — extend `usage.test.js`, `billing.test.js`, `github.test.js`, `phases.test.js`, `templates.test.js`, `useUsage.test.ts` with failing `it` blocks that assert the CORRECT shapes/payloads. Run to confirm they fail against current code.
1. **[R1 usage]** — `frontend/src/api/usage.ts` + `frontend/src/views/ProjectDetail.vue`
2. **[R2 billing]** — `frontend/src/api/billing.ts` + `frontend/src/composables/useUsage.ts`
3. **[R3 PR]** — `frontend/src/api/github.ts` + `frontend/src/views/GitHubConnections.vue`
4. **[R4 phases]** — `frontend/src/api/phases.ts`
5. **[R5 templates]** — `frontend/src/api/templates.ts`
6. **[Fill tests]** — fill stubs with assertions; run full suite

*Depends on*: each step is independent; step 6 depends on all.

#### Phase 1: Backend
Backend API already exists and is correct — **no changes needed**.

#### Phase 2: Frontend API Client

1. `frontend/src/api/usage.ts` (R1)
   - Replace `Usage` interface with breakdown shape: `{ provider_type?: string; model: string; total_in: number; total_out: number; total_cost: number; total_calls: number }`
   - Keep `UsageResponse` (`{ breakdown: Usage[]; totals: UsageTotals }`), `UsageTotals` (camelCase), `ModelPricing` unchanged
2. `frontend/src/api/billing.ts` (R2)
   - `getProjectBilling(projectId: string): Promise<Billing[] | null>` — `.catch(() => null)`
   - `Billing` interface: `{ provider_type: string; model: string; total_cost: number; total_in: number; total_out: number; total_calls: number; billing_month?: string; project_id?: string }`
   - `getUserBilling` unchanged (`Billing[]`)
3. `frontend/src/api/github.ts` (R3)
   - `createPR(ticketId: string, description: string, projectId?: string): Promise<PullRequest>` → `post(\`/api/v1/github/${ticketId}/pr\`, { description, projectId })`
   - Remove `title`/`body`/`branchName` args
4. `frontend/src/api/phases.ts` (R4)
   - `fetchPhases(ticketId)` → `Promise<{ phase: string }>`
   - `fetchAllowedPhases(ticketId)` → `Promise<{ allowed: AllowedPhase[] }>`
   - `transitionPhase(ticketId, targetPhase, metadata?, actorType?)` → `Promise<{ ticketId: string; fromPhase: string; toPhase: string; status: string }>`
   - Keep `Phase` (history) and `AllowedPhase` interfaces
5. `frontend/src/api/templates.ts` (R5)
   - `createTemplate(projectId, data: { name: string; description?: string; file_definitions: { key: string; content: string }[] })`
   - `updateTemplate(projectId, templateId, data: Partial<...same...>)`
   - `Template` interface: `{ id: string; name: string; project_id: string; description: string | null; file_definitions: { key: string; content: string }[]; created_at: string; updated_at: string }`

#### Phase 3: Frontend UI

1. `frontend/src/views/ProjectDetail.vue` (R1) — breakdown `<td>` (lines 241-244):
   - `model.calls` → `model.total_calls`
   - `model.tokens_in` → `model.total_in`
   - `model.tokens_out` → `model.total_out`
   - `model.cost` → `model.total_cost`
   - Keep `<td>{{ model.model }}</td>` and `:key="model.model"`
2. `frontend/src/composables/useUsage.ts` (R2) — line 31:
   - `billing.value = result ? [result] : []` → `billing.value = result ?? []`
3. `frontend/src/views/GitHubConnections.vue` (R3) — line 138:
   - `await createPR(prTicketId.value.trim(), prTitle.value.trim(), prBody.value.trim(), prBranchName.value.trim())` → `await createPR(prTicketId.value.trim(), prBody.value.trim())`
   - Keep `prTitle`/`prBranchName` refs + inputs + submit guard (line 133) as-is (deferred UX cleanup)

#### Phase 4: Integration
No OpenAPI/generated-type regeneration (backend untouched; generated client handled in fg-13 F6). No validator.ts change.

---

### c) Per-File Action Plan

#### `frontend/src/api/usage.ts` (MODIFY)
- Replace `Usage` interface (lines 3-11) with breakdown shape `total_in/total_out/total_cost/total_calls`
- Imports unchanged (`import { get } from './client'`)

#### `frontend/src/api/billing.ts` (MODIFY)
- Change `getProjectBilling` return to `Billing[] | null` (line 13-14)
- Replace `Billing` interface (lines 3-11)

#### `frontend/src/composables/useUsage.ts` (MODIFY)
- Line 31: `billing.value = result ?? []`

#### `frontend/src/api/github.ts` (MODIFY)
- Replace `createPR` signature + payload (line 56)

#### `frontend/src/views/GitHubConnections.vue` (MODIFY)
- Line 138: pass `(prTicketId, prBody)`

#### `frontend/src/api/phases.ts` (MODIFY)
- Fix 3 return types (lines 13, 18, 28)

#### `frontend/src/api/templates.ts` (MODIFY)
- Fix `Template` interface (lines 3-9) + `createTemplate`/`updateTemplate` signatures (lines 17, 22)

---

### d) Dependencies
- Frontend API client `client.ts` `get`/`post`/`extractData`
- `useUsage.ts` composable (R2)
- Views: `ProjectDetail.vue`, `GitHubConnections.vue`, `PhaseFlow.vue` (reads `.phase`/`.allowed` — unchanged), `ProjectTemplates.vue` (already sends `file_definitions`)

---

### e) Risks/Edge Cases
- **[R2 shape]**: billing fallback shape `{ provider_type, model, total_in, total_out, total_cost, total_calls }` confirmed from `BillingService.getUsageSince`. Type accordingly; template already reads `total_cost`/`provider_type`/`model`.
- **[R3 dead inputs]**: `prTitle`/`prBranchName` inputs remain but are not sent; backend derives title/branch from the ticket DB row (`createTicketPR`). Deferred UX cleanup.
- **[R1 key]**: keep `:key="model.model"`; only the cell reads change.

---

### f) Testing

**MANDATORY: EXTEND existing test files for all changed code.** Test stubs first per `04_SPECIFICATION.md`.

#### Frontend Unit Tests (EXTENDED)
- `frontend/src/__tests__/usage.test.js` (R1): assert breakdown row fields are `total_in`/`total_out`/`total_cost`/`total_calls`
- `frontend/src/__tests__/billing.test.js` (R2): assert `getProjectBilling` returns array; `Billing` fields
- `frontend/src/__tests__/useUsage.test.ts` (R2): assert `billing` is a flat array (no nested `[result]`)
- `frontend/src/__tests__/github.test.js` (R3): assert `createPR` posts `{ description }`, not `{ title, body, branchName }`
- `frontend/src/__tests__/phases.test.js` (R4): assert return shapes `{ phase }`/`{ allowed }`/transition result
- `frontend/src/__tests__/templates.test.js` (R5): assert `createTemplate` payload `{ name, description, file_definitions }`

#### Frontend Contract Tests
- Not applicable — no backend response shape change (`api-contract.test.ts`, `validator.ts` unaffected)

#### CI Requirements
- `npm test -- --run` (frontend)
- `npm test -- --run --coverage` (frontend, 60% min)
- `npm run lint`, `npm run typecheck`, `npm run build`

---

### g) Migration Notes
None.

---

### h) Files Changed

**Backend:** none

**Frontend:**
```
frontend/src/api/usage.ts              → MODIFY (R1 interface)
frontend/src/views/ProjectDetail.vue   → MODIFY (R1 breakdown cells)
frontend/src/api/billing.ts            → MODIFY (R2 return type + interface)
frontend/src/composables/useUsage.ts   → MODIFY (R2 no re-wrap)
frontend/src/api/github.ts             → MODIFY (R3 createPR payload)
frontend/src/views/GitHubConnections.vue → MODIFY (R3 call)
frontend/src/api/phases.ts             → MODIFY (R4 return types)
frontend/src/api/templates.ts          → MODIFY (R5 signature + interface)

Tests (EXTENDED):
frontend/src/__tests__/usage.test.js
frontend/src/__tests__/billing.test.js
frontend/src/__tests__/useUsage.test.ts
frontend/src/__tests__/github.test.js
frontend/src/__tests__/phases.test.js
frontend/src/__tests__/templates.test.js
```

---

### Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | R3 (this ticket) | PR form `prTitle`/`prBranchName` inputs ignored by backend (derives from ticket); drop/hide inputs | UX | bp-XX-pr-form-cleanup | ☐ |
| 2 | fg-13 F6 | Generated API client stale/unused | Developer experience | fg-13 F6 | ☐ |
| 3 | fg-13 | `postWithHeaders` dead export | Developer experience | bp-XX-dead-code-cleanup | ☐ |
| 4 | bp-80 | Route-mount drift audit tooling | Developer experience | bp-XX-route-mount-audit | ☐ |

---

### i) Code Review Checklist

- [x] Frontend API client uses existing `get`/`post` from `./client`
- [x] Frontend API client handles errors with `.catch()` (preserved)
- [x] Frontend types match backend response shapes (this is the fix)
- [x] All tests written and passing — changed code has corresponding test files EXTENDED
- [x] Coverage threshold enforced: `npm test -- --run --coverage` — 60% min
- [x] Pending scope items presented to user

---

### j) Post-Deploy Verification

1. [x] Frontend: `npm test -- --run` passes
2. [x] Frontend: `npm run lint` passes
3. [x] Frontend: `npm run typecheck` passes
4. [x] Frontend: `npm run build` passes
5. [x] Frontend: `npm test -- --run --coverage` passes (60% min)
6. [x] ProjectDetail usage breakdown shows real numbers (not 0)
7. [x] ProjectDetail billing shows real numbers (not 0)
8. [x] GitHubConnections PR creation sends the description

---

*Fill in all sections before starting implementation. Update status as work progresses. The "Files Changed" section is the most important — it prevents agents from creating redundant code by forcing them to check what already exists.*
