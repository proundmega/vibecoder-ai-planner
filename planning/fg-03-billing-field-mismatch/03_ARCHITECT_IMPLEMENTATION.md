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

Fix the billing cards in the Usage & Billing tab so they display actual cost data. The frontend accesses field names that don't exist in the backend response. The backend returns raw `project_billing` rows with snake_case column names.

---

### b) Actions

**Backend API already exists — no changes needed.**

#### Phase 1: Frontend UI

1. Fix `frontend/src/views/ProjectDetail.vue` — billing tab section (~lines 560-610):

   Update the billing cards to use correct field paths:
   ```vue
   <!-- "Total Cost" card → show total_cost_usd from first row -->
   <div class="billing-value">${{ (billing?.[0]?.total_cost_usd || 0).toFixed(4) }}</div>
   
   <!-- "Period Start" → derive from earliest billing_month -->
   <div class="billing-value">
     {{ billing?.length ? new Date(billing[billing.length - 1].billing_month).toLocaleDateString() : 'N/A' }}
   </div>
   
   <!-- "Period End" → derive from latest billing_month -->
   <div class="billing-value">
     {{ billing?.length ? new Date(billing[0].billing_month).toLocaleDateString() : 'N/A' }}
   </div>
   
   <!-- "Plan" → show static text -->
   <div class="billing-value">Usage-based</div>
   ```

2. Replace the `daily_costs` section with a table showing the returned billing rows:
   ```vue
   <table v-if="billing?.length > 0">
     <thead>
       <tr>
         <th>Month</th>
         <th>Cost</th>
         <th>Calls</th>
       </tr>
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

#### Phase 2: Testing

3. Run frontend tests: `cd frontend && npm test -- --run`
4. Run frontend lint: `cd frontend && npm run lint`
5. Run frontend typecheck: `cd frontend && npm run typecheck`
6. Manual test: Navigate to Usage & Billing tab, verify billing cards show actual values

---

### c) Dependencies

- None — frontend-only fix

---

### d) Risks/Edge Cases

- **[Risk]**: `billing` is null/undefined or empty array before data loads
  **[Mitigation]**: Use optional chaining (`?.`) and fallback to "N/A" or "0"

---

### e) Testing

#### Frontend Unit Tests
- [ ] `npm test -- --run` — no regressions

#### CI Requirements
- [ ] `npm run lint` — frontend lint passes
- [ ] `npm run typecheck` — frontend typecheck passes

---

### f) Migration Notes

Not applicable — no database changes.

---

### g) Files Changed

**Frontend:**
```
frontend/src/views/ProjectDetail.vue  → fix billing card field paths and daily_costs table
```

---

### h) Code Review Checklist

- [ ] Billing cards use `billing[0]?.total_cost_usd`, `billing[0]?.billing_month`, etc.
- [ ] Optional chaining used for safety (`?.`)
- [ ] Fallback to "N/A" or "0" for empty data
- [ ] Daily costs section shows actual billing data
- [ ] All tests pass
- [ ] No backend changes needed

---

### i) Post-Deploy Verification

1. [ ] `cd frontend && npm test -- --run` passes
2. [ ] `cd frontend && npm run lint` passes
3. [ ] `cd frontend && npm run typecheck` passes
4. [ ] Navigate to Usage & Billing tab → billing cards show actual values
5. [ ] Daily costs table shows billing months with costs
