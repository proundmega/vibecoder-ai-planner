# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Template

**Use this template for every ticket.** Copy this file into the ticket folder and fill in the sections.

---

## Ticket: fg-02 — Fix usage API field name mismatch

**Status**: planned | in_progress | completed | blocked
**Priority**: P1
**Effort**: Small
**Author**: AI Assistant
**Date created**: 2026-06-19
**Date completed**: YYYY-MM-DD
**PR**: [link]
**Branch**: [branch-name]
**Scope**: Frontend

**Dependencies**: None

---

### a) Purpose

Fix the usage cards in the Usage & Billing tab so they display actual values instead of 0. The frontend accesses wrong field names (`total_requests`, `total_cost`, `total_tokens`, `avg_response_time_ms`) that don't exist in the backend response. The backend returns `totals.totalCalls`, `totals.totalCost`, `totals.totalTokensIn`, `totals.totalTokensOut`.

---

### b) Actions

**Backend API already exists — no changes needed.**

#### Implementation Order

Steps must be executed in this exact order (dependencies between steps are noted):

1. **[Fix usage card field paths]** — `frontend/src/views/ProjectDetail.vue`
   - Find the usage tab section (~lines 520-540, grep for `usage.total_requests` or `usage.total_cost`)
   - Update card field paths:
     - `usage.total_requests` → `usage.totals?.totalCalls || 0`
     - `usage.total_cost` → `usage.totals?.totalCost || 0` (format as currency)
     - `usage.total_tokens` → `usage.totals?.totalTokensIn || 0` + `usage.totals?.totalTokensOut || 0` (or show two separate cards)
   - Remove "Avg Response Time" card (backend doesn't provide this)
   - *Depends on*: nothing

2. **[Run verification]** — `cd frontend`
   - `npm test -- --run` — no regressions
   - `npm run lint` — no lint errors
   - `npm run typecheck` — no TS errors
   - *Depends on*: Step 1

---

### c) Per-File Action Plan

#### `frontend/src/views/ProjectDetail.vue` (MODIFY)
- **Change**: Fix usage card field paths in Usage & Billing tab
- **Position**: Usage tab section (~lines 520-540)
- **Specific changes**:
  ```vue
  <!-- Before: -->
  <div class="usage-value">{{ usage.total_requests || 0 }}</div>
  <div class="usage-value">${{ (usage.total_cost || 0).toFixed(4) }}</div>
  <div class="usage-value">{{ usage.total_tokens || 0 }}</div>
  <div class="usage-value">{{ usage.avg_response_time_ms || 0 }}ms</div>

  <!-- After: -->
  <div class="usage-value">{{ usage.totals?.totalCalls || 0 }}</div>
  <div class="usage-value">${{ (usage.totals?.totalCost || 0).toFixed(4) }}</div>
  <div class="usage-value">{{ (usage.totals?.totalTokensIn || 0) + (usage.totals?.totalTokensOut || 0) }}</div>
  <!-- Remove avg_response_time_ms card entirely -->
  ```
- **Imports needed**: None (existing imports unchanged)
- **Safety**: Use optional chaining (`?.`) and `|| 0` fallback for all field accesses

---

### d) Dependencies

- None — this is a frontend-only fix, no backend changes, no new dependencies

---

### e) Risks/Edge Cases

- **[Risk]**: `usage` might be `null` or `undefined` before data loads
  **[Mitigation]**: Use optional chaining (`?.`) and fallback to `0`

---

### f) Testing

**MANDATORY: You must CREATE new test files or EXTEND existing test files for all new/changed code.**
**It is NOT sufficient to only verify that existing tests still pass.**

#### Backend Unit Tests
- No backend changes — existing tests should pass

#### Backend Jest Integration Tests
- N/A — no backend changes

#### Backend Bash Integration Suite
- N/A — no backend API changes

#### Frontend Unit Tests
- [ ] `npm test -- --run` — verify no regressions in `frontend/src/__tests__/usage.test.js`
- [ ] If `usage.test.js` exists: verify it tests the usage API client response shape

#### Frontend E2E Tests
- [ ] Manual: Navigate to Usage & Billing tab, verify cards show actual values (not 0)

#### Frontend Contract Tests
- [ ] `frontend/src/__tests__/api-contract.test.ts` — verify usage response shape includes `totals.totalCalls`, `totals.totalCost`, `totals.totalTokensIn`, `totals.totalTokensOut`
- [ ] `frontend/src/api/validator.ts` — verify usage response schema expects `totals` object

---

### g) Migration Notes

Not applicable — no database changes.

---

### h) Files Changed

**Frontend:**
```
frontend/src/views/ProjectDetail.vue  → MODIFY: fix usage card field paths in Usage & Billing tab
```

---

### i) Code Review Checklist

- [ ] Usage cards use `usage.totals?.totalCalls`, `usage.totals?.totalCost`, etc.
- [ ] Optional chaining used for safety (`?.`)
- [ ] Fallback to 0 for empty data (`|| 0`)
- [ ] "Avg Response Time" card removed (backend doesn't provide this)
- [ ] No backend changes needed
- [ ] Frontend API client follows existing patterns (`get`, `post`, `put`, `del`, `patch` from `./client`)
- [ ] Frontend UI follows existing patterns (CSS classes, component structure)
- [ ] Frontend UI handles loading, error, and empty states (unchanged from before)
- [ ] All tests written and passing — existing tests still pass
- [ ] OpenAPI spec regenerated if backend routes changed (N/A — no backend changes)
- [ ] Generated TypeScript types regenerated if response shapes changed (N/A — no backend changes)
- [ ] Generated types compile: `npm run typecheck`
- [ ] Response validation updated: `frontend/src/api/validator.ts` matches backend changes (N/A — no backend changes)
- [ ] Contract test updated: `frontend/src/__tests__/api-contract.test.ts` covers usage shape with `totals` object
- [ ] Coverage checked: no significant decrease in changed modules

---

### j) Post-Deploy Verification

1. [ ] `cd frontend && npm test -- --run` passes
2. [ ] `cd frontend && npm run lint` passes
3. [ ] `cd frontend && npm run typecheck` passes
4. [ ] `cd frontend && npm run build` passes
5. [ ] Navigate to Usage & Billing tab → cards show actual values (not 0)
6. [ ] Make an API call, refresh tab → values update
7. [ ] Verify no console errors for undefined properties

---

*Fill in all sections before starting implementation. Update status as work progresses. The "Files Changed" section is the most important — it prevents agents from creating redundant code by forcing them to check what already exists.*
