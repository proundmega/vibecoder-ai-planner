# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Template

**Use this template for every ticket.** Copy this file into the ticket folder and fill in the sections.

---

## Ticket: fg-03 — Fix billing API field name mismatch

**Status**: planned | in_progress | completed | blocked
**Priority**: P1
**Effort**: Medium
**Author**: AI Assistant
**Date created**: 2026-06-19
**Date completed**: YYYY-MM-DD
**PR**: [link]
**Branch**: [branch-name]
**Scope**: Frontend

**Dependencies**: None

---

### a) Purpose

Fix the billing cards in the Usage & Billing tab so they display actual cost data. The frontend accesses field names (`billing.total_cost`, `billing.current_period_start`, etc.) that don't exist in the backend response. The backend returns raw `project_billing` rows with snake_case column names (`total_cost_usd`, `billing_month`, `total_calls`).

---

### b) Actions

**Backend API already exists — no changes needed.**

#### Implementation Order

Steps must be executed in this exact order (dependencies between steps are noted):

1. **[Fix billing card field paths]** — `frontend/src/views/ProjectDetail.vue`
   - Find the billing tab section (~lines 560-610, grep for `billing.total_cost`)
   - Update card field paths:
     - `billing.total_cost` → `billing?.[0]?.total_cost_usd || 0` (format as currency)
     - `billing.current_period_start` → `billing?.length ? new Date(billing[billing.length - 1].billing_month).toLocaleDateString() : 'N/A'`
     - `billing.current_period_end` → `billing?.length ? new Date(billing[0].billing_month).toLocaleDateString() : 'N/A'`
     - `billing.plan` → static text "Usage-based"
   - Replace `daily_costs` section with a table showing actual billing rows
   - *Depends on*: nothing

2. **[Run verification]** — `cd frontend`
   - `npm test -- --run` — no regressions
   - `npm run lint` — no lint errors
   - `npm run typecheck` — no TS errors
   - *Depends on*: Step 1

---

### c) Per-File Action Plan

#### `frontend/src/views/ProjectDetail.vue` (MODIFY)
- **Change**: Fix billing card field paths and daily_costs table
- **Position**: Billing tab section (~lines 560-610)
- **Specific changes**:
  ```vue
  <!-- "Total Cost" card → show total_cost_usd from first row -->
  <div class="billing-value">${{ (billing?.[0]?.total_cost_usd || 0).toFixed(4) }}</div>

  <!-- "Period Start" → derive from earliest billing_month -->
  <div class="billing-value">{{ billing?.length ? new Date(billing[billing.length - 1].billing_month).toLocaleDateString() : 'N/A' }}</div>

  <!-- "Period End" → derive from latest billing_month -->
  <div class="billing-value">{{ billing?.length ? new Date(billing[0].billing_month).toLocaleDateString() : 'N/A' }}</div>

  <!-- "Plan" → show static text -->
  <div class="billing-value">Usage-based</div>

  <!-- Daily costs → show the returned array in a table -->
  <table v-if="billing?.length > 0">
    <thead>
      <tr><th>Month</th><th>Cost</th><th>Calls</th></tr>
    </thead>
    <tbody>
      <tr v-for="row in billing" :key="row.billing_month">
        <td>{{ row.billing_month }}</td>
        <td>${{ (row.total_cost_usd || 0).toFixed(4) }}</td>
        <td>{{ row.total_calls || 0 }}</td>
      </tr>
    </tbody>
  </table>
  <p v-else>No billing data available</p>
  ```
- **Imports needed**: None (existing imports unchanged)
- **Safety**: Use optional chaining (`?.`) and fallback to "N/A" or "0" for all field accesses

---

### d) Dependencies

- None — this is a frontend-only fix, no backend changes, no new dependencies

---

### e) Risks/Edge Cases

- **[Risk]**: `billing` might be `null`, `undefined`, or empty array before data loads
  **[Mitigation]**: Use optional chaining (`?.`) and fallback to "N/A" or "0"

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
- [ ] `npm test -- --run` — verify no regressions in `frontend/src/__tests__/billing.test.js`
- [ ] If `billing.test.js` exists: verify it tests the billing API client response shape

#### Frontend E2E Tests
- [ ] Manual: Navigate to Usage & Billing tab, verify billing cards show actual values

#### Frontend Contract Tests
- [ ] `frontend/src/__tests__/api-contract.test.ts` — verify billing response shape includes `total_cost_usd`, `billing_month`, `total_calls`
- [ ] `frontend/src/api/validator.ts` — verify billing response schema expects array of billing rows

---

### g) Migration Notes

Not applicable — no database changes.

---

### h) Files Changed

**Frontend:**
```
frontend/src/views/ProjectDetail.vue  → MODIFY: fix billing card field paths and daily_costs table
```

---

### i) Code Review Checklist

- [ ] Billing cards use `billing?.[0]?.total_cost_usd`, `billing?.[0]?.billing_month`, etc.
- [ ] Optional chaining used for safety (`?.`)
- [ ] Fallback to "N/A" or "0" for empty data
- [ ] Daily costs section shows actual billing data in a table
- [ ] "Plan" card shows "Usage-based" static text
- [ ] No backend changes needed
- [ ] Frontend API client follows existing patterns (`get`, `post`, `put`, `del`, `patch` from `./client`)
- [ ] Frontend UI follows existing patterns (CSS classes, component structure)
- [ ] Frontend UI handles loading, error, and empty states (unchanged from before)
- [ ] All tests written and passing — existing tests still pass
- [ ] OpenAPI spec regenerated if backend routes changed (N/A — no backend changes)
- [ ] Generated TypeScript types regenerated if response shapes changed (N/A — no backend changes)
- [ ] Generated types compile: `npm run typecheck`
- [ ] Response validation updated: `frontend/src/api/validator.ts` matches backend changes (N/A — no backend changes)
- [ ] Contract test updated: `frontend/src/__tests__/api-contract.test.ts` covers billing shape with array of rows
- [ ] Coverage checked: no significant decrease in changed modules

---

### j) Post-Deploy Verification

1. [ ] `cd frontend && npm test -- --run` passes
2. [ ] `cd frontend && npm run lint` passes
3. [ ] `cd frontend && npm run typecheck` passes
4. [ ] `cd frontend && npm run build` passes
5. [ ] Navigate to Usage & Billing tab → billing cards show actual values
6. [ ] Daily costs table shows billing months with costs
7. [ ] Verify no console errors for undefined properties

---

*Fill in all sections before starting implementation. Update status as work progresses. The "Files Changed" section is the most important — it prevents agents from creating redundant code by forcing them to check what already exists.*
