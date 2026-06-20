# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: {{planned | in_progress | completed}}
**Date created**: 2026-06-19
**Date completed**: {{YYYY-MM-DD}}
**Author**: AI Assistant
**Scope**: Frontend
**Priority**: P1
**Effort**: Medium

---

## Requirement

Fix the field name mismatch in the Billing API response. The frontend accesses `billing.total_cost`, `billing.current_period_start`, `billing.current_period_end`, `billing.plan`, `billing.daily_costs` but the backend returns raw database rows from `project_billing` and `usage_logs` tables with snake_case column names.

**Current behavior**: Billing cards show N/A or empty because the fields don't exist.
**Expected behavior**: Billing cards display actual cost data and billing period info.

---

## Existing Infrastructure Audit

**CRITICAL**: Before planning, audit what already exists. Do NOT create new code if existing code can be extended.

### Backend API Check
- [x] API route exists: `backend/src/api/billing.js` — YES
- [x] Controller exists: `backend/src/controllers/billingController.js` — YES
- [x] Service exists: `backend/src/services/BillingService.js` — YES
- [x] Route is mounted: `backend/src/api/v1/index.js:36` — YES (`/billing`)
- [x] OpenAPI JSDoc annotations exist — YES

### Frontend API Client Check
- [x] API client exists: `frontend/src/api/billing.js` — YES
- [x] API client functions cover all needed endpoints — YES
- [x] API client follows existing patterns — YES

### Frontend UI Check
- [x] View component exists: `frontend/src/views/ProjectDetail.vue` — YES (Usage & Billing tab)
- [x] Existing tab where this feature lives — YES (Usage & Billing tab at line ~560)
- [x] Existing pattern to extend — YES (billing cards)

### Integration Check
- [x] Frontend API client can call existing backend endpoints — YES (paths are correct)
- [ ] Response shapes match — NO (frontend accesses wrong field names)
- [x] Auth tokens are used correctly — YES
- [x] Error handling matches existing patterns — YES

### Key Insight

This is a **FRONTEND fix** (possibly with a small backend controller enhancement). The backend returns raw database rows:

**`BillingService.getProjectBilling()`** returns `project_billing` rows:
```json
{ id, project_id, billing_month, total_cost_usd, total_tokens_in, total_tokens_out, total_calls }
```

**`BillingService.getUsageSince()`** returns `usage_logs` aggregated rows:
```json
{ provider_type, model, total_in, total_out, total_cost, total_calls }
```

The frontend expects:
- `billing.total_cost` → backend has `total_cost_usd` (in project_billing rows)
- `billing.current_period_start/end` → backend has no such fields
- `billing.plan` → backend has no such field
- `billing.daily_costs` → backend returns an array, not a daily_costs object

---

## Scope

### In Scope
- [ ] Map backend response fields to frontend expectations in `frontend/src/views/ProjectDetail.vue`:
  - `billing.total_cost` → use `billing[0]?.total_cost_usd || 0` (from project_billing)
  - `billing.current_period_start/end` → derive from `billing[0]?.billing_month` or show "N/A"
  - `billing.plan` → show "Usage-based" (no plan concept in current backend)
  - `billing.daily_costs` → map from the returned array or show "No data"

### Out of Scope
- Adding `current_period_start/end`, `plan` fields to the backend
- Creating a subscription/plan system
- Backend changes to the billing response structure (unless minimal)

---

## Important Design Decisions

**DECISION POINTS**:

1. **How to handle missing fields (current_period, plan)?**
   - A) Show "N/A" or "Usage-based" as placeholders
   - B) Add these fields to the backend (requires schema change)
   - C) Remove the UI elements that display them
   
   **Recommendation**: Option A — show "N/A" for now. These fields would require a subscription system which is out of scope.

2. **How to display `daily_costs`?**
   - A) Map the returned array to the daily_costs format
   - B) Show a simple table of the returned data
   - C) Remove the daily_costs section
   
   **Recommendation**: Option B — show the returned data in a table with the actual column names.

---

## Acceptance Criteria

1. [ ] [Frontend UI] Billing card "Total Cost" displays `billing[0]?.total_cost_usd` (formatted as currency)
2. [ ] [Frontend UI] Billing card "Period Start" shows the earliest `billing_month` or "N/A"
3. [ ] [Frontend UI] Billing card "Period End" shows the latest `billing_month` or "N/A"
4. [ ] [Frontend UI] Billing card "Plan" shows "Usage-based" (no plan system yet)
5. [ ] [Frontend UI] Daily costs table shows actual billing data from the backend
6. [ ] [Frontend UI] When billing data is empty, cards show "N/A" or "0" (not errors)
7. [ ] [Both] All tests pass (`npm test` in frontend)
8. [ ] [Both] Linting passes (`npm run lint` in frontend)
9. [ ] [Both] Frontend typecheck passes (`npm run typecheck`)

---

## Out of Scope

- Adding subscription/plan system to the backend
- Adding `current_period_start/end` fields to the billing API
- Creating a billing history page
- Backend changes to the billing response structure (beyond minimal mapping)

---

## Testing Checklist

### Frontend Tests
- [ ] Unit tests: `npm test -- --run` — no regressions
- [ ] Manual verification: Navigate to Usage & Billing tab, verify billing cards show actual values

### CI Requirements
- [ ] `npm run lint` — frontend lint passes
- [ ] `npm run typecheck` — frontend typecheck passes

---

## Anti-Patterns to Avoid

- ❌ **Changing the backend response** — the backend returns raw data which is fine
- ❌ **Creating a transformation service** — just fix the field paths in the template
- ❌ **Ignoring the array structure** — the backend returns an array of rows, not a single object
