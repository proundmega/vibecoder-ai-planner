# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Frontend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

The billing section of the Usage & Billing tab shows N/A or empty values. The frontend accesses `billing.total_cost`, `billing.current_period_start`, etc. but the backend returns raw database rows with snake_case column names (`total_cost_usd`, `billing_month`, etc.) and no `current_period` or `plan` fields.

---

## Current State

### Existing Backend
- **Route**: `GET /api/v1/billing/project/:id` — `billingController.getProjectBilling()`
- **Service**: `BillingService.getProjectBilling()` returns `project_billing` rows:
  ```json
  [{ id, project_id, billing_month, total_cost_usd, total_tokens_in, total_tokens_out, total_calls }]
  ```
- **Service**: `BillingService.getUsageSince()` returns usage_logs aggregated rows:
  ```json
  [{ provider_type, model, total_in, total_out, total_cost, total_calls }]
  ```
- **Controller**: Returns `{ success: true, data: billing }` where billing is the raw array

### Existing Frontend
- **API Client**: `frontend/src/api/billing.js` — calls `GET /api/v1/billing/project/:id`
- **UI**: `frontend/src/views/ProjectDetail.vue:573-606` accesses wrong field names:
  ```javascript
  billing.total_cost          // → undefined (should be billing[0]?.total_cost_usd)
  billing.current_period_start  // → undefined (no such field in backend)
  billing.current_period_end    // → undefined (no such field in backend)
  billing.plan                  // → undefined (no such field in backend)
  billing.daily_costs           // → undefined (backend returns array, not daily_costs)
  ```

### Gap Analysis
- Backend returns correct raw data from database tables
- Frontend accesses fields that don't exist in the response
- Billing section shows N/A or empty for all cards

---

## Design

### Option A: Map Fields in Frontend Template (Recommended)

**Changes in `frontend/src/views/ProjectDetail.vue` (billing tab section, ~lines 560-610):**

```vue
<!-- "Total Cost" card → show total_cost_usd from first billing row -->
<div class="billing-value">${{ (billing?.[0]?.total_cost_usd || 0).toFixed(4) }}</div>

<!-- "Period Start" → derive from earliest billing_month -->
<div class="billing-value">{{ billing?.length ? new Date(billing[billing.length - 1].billing_month).toLocaleDateString() : 'N/A' }}</div>

<!-- "Period End" → derive from latest billing_month -->
<div class="billing-value">{{ billing?.length ? new Date(billing[0].billing_month).toLocaleDateString() : 'N/A' }}</div>

<!-- "Plan" → show static text -->
<div class="billing-value">Usage-based</div>

<!-- Daily costs → show the returned array in a table -->
<table v-if="billing?.length > 0">
  <tr v-for="row in billing" :key="row.billing_month">
    <td>{{ row.billing_month }}</td>
    <td>${{ (row.total_cost_usd || 0).toFixed(4) }}</td>
    <td>{{ row.total_calls || 0 }}</td>
  </tr>
</table>
```

**Why this is the right choice**: Minimal change, works with the existing backend response. Shows "N/A" for fields that don't exist yet (plan, current_period).

### Option B: Add Response Transformation in API Client

Add a mapping layer in `frontend/src/api/billing.js` to normalize the response.

**Pros**: Centralizes the transformation.
**Cons**: Hides the real data structure. The backend returns simple raw rows — no transformation needed.
**Decision**: Option A is better — the UI should work with the actual API response.

### Option C: Enhance Backend Controller to Return Expected Shape

Modify `billingController.js` to return a normalized response with `total_cost`, `current_period`, `plan`, `daily_costs`.

**Pros**: Frontend would work without changes.
**Cons**: Requires backend changes for fields that don't exist (plan, current_period). Over-engineering.
**Decision**: Option A is better — fix the consumer, not the producer.

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `frontend/src/views/ProjectDetail.vue` | MODIFY | Billing tab section (~lines 560-610): fix field paths in billing cards and daily_costs table |

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Frontend unit | Vitest | `frontend/src/__tests__/billing.test.js` | API client returns correct shape |
| Frontend contract | Vitest | `frontend/src/__tests__/api-contract.test.ts` | Response shape includes billing row fields |
| Frontend component | Cypress | `frontend/cypress/component/` | Billing cards render with mock data |
| Frontend E2E | Cypress | `frontend/cypress/e2e/` | Full billing tab flow |

### Frontend-Backend Contract Testing

- Response schemas in `frontend/src/api/validator.ts` must include billing row fields: `total_cost_usd`, `billing_month`, `total_calls`
- If the contract test has a billing shape assertion, verify it matches the backend's actual response (array of rows)
- Generated TypeScript types from OpenAPI spec should include the billing row structure — verify by running `npm run generate:spec && npm run generate:api && npm run typecheck`

---

## Security Considerations

- No new endpoints — existing auth/authorization applies unchanged
- No new data exposure — field fix does not change what data is returned
- No input changes — this is purely a template rendering fix

---

## Data Flow Diagram

```
[Backend] → GET /api/v1/billing/project/:id
  → [{ billing_month, total_cost_usd, total_tokens_in, total_tokens_out, total_calls }]
  → [Frontend API client] → returns response.data (array of rows)
  → [Vue template] → billing[0]?.total_cost_usd, billing[0]?.billing_month, etc.
  → [User sees correct billing values]
```

---

## Dependencies

### Backend Dependencies
- None — backend returns correct raw data

### Frontend Dependencies
- `frontend/src/views/ProjectDetail.vue` — fix billing card field paths

### Cross-Cutting Dependencies
- None

---

## Config / Environment Changes

- No env var changes
- No database migrations
- No npm dependency changes

---

## Risks and Edge Cases

### Frontend Risks
- **[Risk]**: `billing` might be `null` or empty array before data loads
  **[Mitigation]**: Use optional chaining (`?.`) and fallback to "N/A" or "0"

### Integration Risks
- None

### Edge Cases
- Empty billing data (no billing records) → show "N/A" for all cards
- Multiple billing months → show latest month's cost, date range for period
- `daily_costs` section → replace with a table showing all billing months

---

## Alternative Designs Considered

### Alternative 1: Transform in API client
- **Pros**: Centralized
- **Cons**: Hides real API structure, unnecessary layer
- **Decision**: Option A is simpler

### Alternative 2: Change backend to match frontend
- **Pros**: Frontend works without changes
- **Cons**: Requires adding non-existent fields (plan, current_period)
- **Decision**: Option A is correct — fix the broken consumer

---

## Specification Generation

- [ ] `04_SPECIFICATION.md` has been created with exact file operations for each file (if a small model will execute this ticket)

---

*This design document guides implementation. The fix is updating field paths in the Vue template and handling the array response structure.*
