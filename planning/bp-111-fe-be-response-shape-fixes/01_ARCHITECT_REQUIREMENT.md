# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: planned
**Date created**: 2026-08-06
**Date completed**:
**Author**: AI Assistant
**Scope**: Frontend
**Priority**: P1
**Effort**: Small

---

## Requirement

A frontend↔backend API audit found **5 response-shape / payload / typing mismatches** where the backend is CORRECT but the frontend reads or types the data wrong. These render real data as zeros (usage breakdown, billing), send the wrong field to create a PR, or declare wrong TypeScript types. All 5 are **frontend-only fixes** — the backend contract is correct and must not change.

**Current behavior**: Usage breakdown columns show 0; billing shows 0; PRs are created without a description; phase/template TypeScript interfaces declare fields that don't exist on the wire.

**Expected behavior**: Frontend reads exactly the fields the backend returns; PR description is sent; TS interfaces match the actual backend response shapes.

The 5 findings:

| # | Finding | Frontend | Backend (correct) | Impact |
|---|---------|----------|-------------------|--------|
| R1 | Usage breakdown field mismatch | `ProjectDetail.vue:241-244` reads `model.calls`, `model.tokens_in`, `model.tokens_out`, `model.cost`; `usage.ts` `Usage` interface declares `input_tokens/output_tokens/total_tokens/cost` | `UsageLogger.getProjectUsage` returns rows `{ provider_type, model, total_in, total_out, total_cost, total_calls }` (`UsageLogger.js:145-155`) | P1 — breakdown shows zeros |
| R2 | Billing response is an array, frontend treats it as a single object and re-wraps it | `billing.ts:13-14` `getProjectBilling` typed `Billing \| null`; `useUsage.ts:31` does `billing.value = result ? [result] : []` | `billingController.js:23-26` returns `{ success, data: <array> }`; default fallback rows are `{ provider_type, model, total_cost, total_calls }` (`BillingService.getUsageSince`) | P1 — billing shows zeros |
| R3 | `createPR` payload mismatch | `github.ts:56` sends `{ title, body, branchName }`; caller `GitHubConnections.vue:138` passes `(ticketId, title, body, branchName)` | `githubController.js:58` reads `description` (and `projectId`) | P1 — PR created without description |
| R4 | Phase API TS interfaces don't match backend shapes | `phases.ts` types `fetchPhases`→`Phase[]`, `fetchAllowedPhases`→`AllowedPhase[]`; `transitionPhase`→`Phase` | `/phases/current`→`{ phase }`, `/phases/allowed`→`{ allowed }`, transition→`{ ticketId, fromPhase, toPhase, status }` (`tickets.js:306,330,372`) | P2 — typing drift (view compensates, runtime OK) |
| R5 | Templates TS interface/signature mismatch | `templates.ts` `createTemplate` signature `{name, content, type}`, `Template` has `content`/`type` | `templateController.js:23` reads `{ name, description, file_definitions }`; template rows have `file_definitions`, `description` | P2 — typing drift (runtime OK because views send the right payload) |

**Context**: `frontend/src/api/client.ts` `extractData` unwraps exactly ONE level: if the parsed body has `.data !== undefined`, it returns `body.data`; otherwise it returns the whole body. All 5 fixes must respect this.

---

## Existing Infrastructure Audit

**CRITICAL**: Before planning, audit what already exists. Do NOT create new code if existing code can be extended.

### Backend API Check
- [x] API route exists: YES for all 5 — backend is correct and NOT modified by this ticket
- [x] Controller exists: YES (`usageController`, `billingController`, `githubController`, `templateController`)
- [x] Service exists: YES (`UsageLogger`, `BillingService`, `GitHubService`, `TemplateService`, `PhaseService`)
- [x] Model exists: N/A
- [x] Validator exists: N/A (backend untouched)
- [x] Route is mounted: YES
- [x] OpenAPI JSDoc annotations exist: YES (not changed)

### Frontend API Client Check
- [x] API client exists: `frontend/src/api/{usage,billing,github,phases,templates}.ts`
- [x] API client functions cover all needed endpoints: YES — but the response types and one payload are wrong
- [x] API client follows existing patterns (`get`, `post`, `put`, `del`, `patch`): YES

### Frontend UI Check
- [x] View component exists: `ProjectDetail.vue` (usage/billing), `GitHubConnections.vue` (PR), `PhaseFlow.vue` (phases), `ProjectTemplates.vue` (templates)
- [x] Component exists: N/A (no new components)
- [x] Route exists: YES (no routing changes)
- [x] Existing tab/section: YES — usage & billing are tabs in `ProjectDetail.vue`
- [x] Existing modal/pattern to extend: N/A

### Integration Check
- [x] Frontend API client can call existing backend endpoints: YES
- [x] Response shapes match (snake_case vs camelCase): **NO for R1–R5** — this is the bug
- [x] Auth tokens are used correctly: YES
- [x] Error handling matches existing patterns: YES

### Key Insight

The backend is the source of truth for all 5 findings. The fixes are:
- **R1**: change `ProjectDetail.vue` breakdown template to read `total_in/total_out/total_cost/total_calls`, and fix the `Usage` interface
- **R2**: `getProjectBilling` should return `Billing[]`; `useUsage.ts` should assign the array directly (no re-wrap); fix the `Billing` interface to the fallback shape `{ provider_type, model, total_cost, total_calls }` (plus optional billing-table fields)
- **R3**: `createPR` should send `{ description, projectId? }` mapping the `body` argument to `description`
- **R4**: correct `phases.ts` return types to match `{ phase }`, `{ allowed }`, and transition result
- **R5**: correct `templates.ts` `createTemplate` signature and `Template` interface to `{ name, description, file_definitions }`

**This ticket is FRONTEND-ONLY.** No backend, migration, or config change.

---

## Scope

### In Scope
- R1: Fix `ProjectDetail.vue:241-244` breakdown template fields + fix `Usage` interface in `usage.ts`
- R2: Fix `billing.ts` `getProjectBilling` to return `Billing[]`; fix `useUsage.ts:31` to assign the array directly; fix `Billing` interface
- R3: Fix `github.ts` `createPR` to send `{ description }` (map `body` arg); verify `GitHubConnections.vue:138` call
- R4: Fix `phases.ts` return types for `fetchPhases`/`fetchAllowedPhases`/`transitionPhase`
- R5: Fix `templates.ts` `createTemplate` signature + `Template` interface
- Regression tests for every fix (bug-fix protocol): extend `usage.test.js`, `billing.test.js`, `github.test.js`, `phases.test.js`, `templates.test.js`, `useUsage.test.ts`

### Out of Scope
- Any backend change (all backend shapes are correct)
- The fg-13 findings (F1–F7: router mounting, planning-usage URL prefix, generated API, terminal WS) — tracked in `planning/fg-13-fe-be-inconsistencies/`
- New UI components or pages
- Changing `extractData` semantics in `client.ts`
- Deleting dead exports (e.g., `getPlanningFileUsage`, `postWithHeaders`) — deferred (see Pending Scope Items)
- Regenerating the generated API client — deferred to fg-13 F6

---

## Pending Scope Items to Present to User

**MANDATORY**: Before presenting this ticket to the user, list all deferred improvements found in previous tickets' "Out of Scope" sections that are relevant to this ticket's domain. The user must be aware of follow-up work before approving implementation.

### Items to Present

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-100 (planning usage) | `getPlanningFileUsage` (per-file usage history) is exported but has no UI call sites — backend-complete, no frontend | UX | bp-XX-planning-file-usage-ui | ☐ |
| 2 | fg-13 (F6) | Generated API client is stale/unused; consider deleting or regenerating to prevent drift | Developer experience | fg-13 F6 | ☐ |
| 3 | fg-13 | `postWithHeaders` in `client.ts` has zero production call sites (dead export) | Developer experience | bp-XX-dead-code-cleanup | ☐ |
| 4 | bp-80 | Orphaned router files suggest a route-mount audit script to prevent regressions | Developer experience | bp-XX-route-mount-audit | ☐ |

**All items above must be presented to the user before ticket approval.**

---

## Deferred Improvements Found (Internal Tracking)

| # | From Ticket | Improvement | Category | Suggested Next Ticket |
|---|-------------|-------------|----------|----------------------|
| 1 | bp-100 | Planning file usage history has no UI | UX | bp-XX-planning-file-usage-ui |
| 2 | fg-13 | Generated API client stale/unused | Developer experience | fg-13 F6 |
| 3 | fg-13 | `postWithHeaders` dead export | Developer experience | bp-XX-dead-code-cleanup |
| 4 | bp-80 | Route-mount drift audit tooling | Developer experience | bp-XX-route-mount-audit |

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `frontend/src/views/ProjectDetail.vue` | MODIFY (R1) | Breakdown `<td>` reads `total_in`/`total_out`/`total_cost`/`total_calls` instead of `tokens_in`/`tokens_out`/`cost`/`calls` |
| `frontend/src/api/usage.ts` | MODIFY (R1) | `Usage` interface fields → `total_in`/`total_out`/`total_cost`/`total_calls` (breakdown) |
| `frontend/src/api/billing.ts` | MODIFY (R2) | `getProjectBilling` → `Billing[]`; `Billing` interface → fallback shape `{ provider_type, model, total_cost, total_calls }` |
| `frontend/src/composables/useUsage.ts` | MODIFY (R2) | `loadBilling` assigns `billing.value = result ?? []` (no `[result]` re-wrap) |
| `frontend/src/api/github.ts` | MODIFY (R3) | `createPR` sends `{ description, projectId? }` mapping `body` → `description` |
| `frontend/src/api/phases.ts` | MODIFY (R4) | Correct return types for `fetchPhases`/`fetchAllowedPhases`/`transitionPhase` |
| `frontend/src/api/templates.ts` | MODIFY (R5) | `createTemplate` signature → `{ name, description, file_definitions }`; fix `Template` interface |
| `backend` | NONE | No backend changes |
| `database` | NONE | No migrations |
| `config` | NONE | No env vars |

---

## Known Unknowns

1. **[R2 billing shape]**: The billing endpoint returns different shapes depending on query: month path → `{ total_cost_usd, total_tokens_in, total_tokens_out, total_calls, billing_month }`; no-filter fallback → `{ provider_type, model, total_cost, total_calls }`. The frontend sends no month/start/end, so the fallback shape applies. **Resolution**: type `Billing` to the fallback shape with optional billing-table fields so both are representable. Verify against `BillingService.getUsageSince` during implementation.
2. **[R3 PR description]**: Backend `createPR` only reads `description` and `projectId` (no `title`/`body`/`branchName`). **Resolution**: map the frontend `body` argument to `description`; keep `title`/`branchName` out of the payload (backend ignores them). Confirm GitHubService.createTicketPR uses only `description`.

---

## Important Design Decisions

**DECISION POINTS** — Items that need user confirmation.

1. **[R2 billing interface]** — Should the frontend `Billing` interface represent the no-filter fallback shape `{ provider_type, model, total_cost, total_calls }` (what the current UI displays) or the billing-table shape `{ total_cost_usd, ... }`? — **Recommended**: represent the fallback shape (matches the live `ProjectDetail.vue` billing template which reads `row.total_cost`, `row.provider_type`, `row.model`), with optional billing-table fields. This is a decision because the two shapes diverge and the UI only renders the fallback today.

**If no decisions need user input, write: "No design decisions require user input. All choices follow existing patterns."**

---

## Acceptance Criteria

1. [ ] [Frontend API] R1: `ProjectDetail.vue` breakdown renders `total_in`/`total_out`/`total_cost`/`total_calls` from `usageData.breakdown` (regression test asserts the exact field names)
2. [ ] [Frontend API] R1: `usage.ts` `Usage` interface declares `total_in`, `total_out`, `total_cost`, `total_calls` (no `input_tokens`/`cost`)
3. [ ] [Frontend API] R2: `getProjectBilling` returns `Billing[]` and `useUsage.ts` assigns the array directly (no nested `[result]`)
4. [ ] [Frontend API] R2: `Billing` interface represents the fallback shape used by the live template
5. [ ] [Frontend API] R3: `createPR` sends `{ description, projectId? }`; `GitHubConnections.vue` PR flow sends the description
6. [ ] [Frontend API] R4: `fetchPhases`→`{ phase: string }`, `fetchAllowedPhases`→`{ allowed: AllowedPhase[] }`, `transitionPhase`→transition result type
7. [ ] [Frontend API] R5: `createTemplate` signature is `{ name, description, file_definitions }`; `Template` interface matches backend rows
8. [ ] [Frontend API] New/modified API client function has test cases in a test file (CREATED or EXTENDED) for all 5
9. [ ] [Frontend API] The API client handles errors consistently with existing clients (`.catch()` fallbacks preserved)
10. [ ] [Both] All frontend tests pass (`npm test -- --run`)
11. [ ] [Both] Coverage threshold enforced: `npm test -- --run --coverage` — min 60%
12. [ ] [Both] Lint passes (`npm run lint`), typecheck passes (`npm run typecheck`), build passes (`npm run build`)
13. [ ] [Both] Specification in `04_SPECIFICATION.md` accurately reflects the implementation

---

## Out of Scope

- Any backend, migration, or config change (backend is the source of truth)
- The fg-13 findings (F1–F7) — separate suite
- New UI components or pages
- Changing `extractData` unwrap semantics
- Regenerating generated API types (fg-13 F6)
- Deleting dead exports (`getPlanningFileUsage`, `postWithHeaders`)

---

## Performance Considerations

- Expected load: negligible (fixes field reads and one payload, no new queries)
- N+1 queries to avoid: N/A
- Caching strategy: N/A
- Pagination needed: N/A

---

## Security Considerations

- [x] Authentication required: NO changes — endpoints unchanged, all use existing `verifyToken`
- [x] Authorization check: NO changes
- [x] Input validation: NO changes (R3 uses the existing `createPRSchema`)
- [x] Rate limiting: NO changes
- [x] Sensitive data handling: NO changes

---

## Testing Checklist

### Test-First Requirement (04_SPECIFICATION.md exists)

- [x] Empty test stub files created BEFORE any production code (listed as first file operations)
- [x] Test stubs contain imports, `describe` blocks, and stub `it` blocks
- [x] After implementation: test stubs filled in with actual assertions

### Frontend Tests
- [x] Unit test files EXTENDED for all changed code: `usage.test.js` (R1), `billing.test.js` + `useUsage.test.ts` (R2), `github.test.js` (R3), `phases.test.js` (R4), `templates.test.js` (R5)
- [x] API client tests assert exact field names / payloads (reproduces the wrong-field/wrong-shape bug)
- [x] Loading, error, and empty states: existing components unchanged, no new UI
- [x] Coverage threshold: `npm test -- --run --coverage` — 60% min

### CI Requirements
- [x] `npm test -- --run` — frontend unit tests pass
- [x] `npm test -- --run --coverage` — frontend coverage threshold passes (60%)
- [x] `npm run lint` — no lint errors
- [x] `npm run typecheck` — frontend typecheck passes
- [x] `npm run build` — frontend build passes

---

## Anti-Patterns to Avoid

- ❌ **Changing the backend** — all 5 backend shapes are correct; the fix is on the frontend
- ❌ **Fixing R1/R2 only in the template but not the interface** — update both the view and the `.ts` interface so types match the wire
- ❌ **Re-wrapping the billing array** — `getProjectBilling` returns an array; assign it directly in `useUsage.ts`
- ❌ **Sending `title`/`body`/`branchName` to `createPR`** — backend reads `description`; map `body` → `description`
- ❌ **Guessing the billing shape** — verify `BillingService.getUsageSince` (fallback path) before typing the interface
- ❌ **Skipping regression tests** — every fix extends a test file that reproduces the original wrong-field/wrong-shape bug
- ❌ **Ignoring coverage threshold** — CI enforces 60% min; run coverage locally

---

*Fill in all sections before starting implementation. The existing infrastructure audit is the most important section — it prevents agents from creating redundant code.*
