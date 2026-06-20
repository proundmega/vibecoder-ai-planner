# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Frontend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

The Usage & Billing tab in ProjectDetail shows usage cards that display 0 for all values. The frontend accesses field names (`total_requests`, `total_cost`, `total_tokens`, `avg_response_time_ms`) that don't exist in the backend response. The backend returns `totals.totalCalls`, `totals.totalCost`, `totals.totalTokensIn`, `totals.totalTokensOut`.

---

## Current State

### Existing Backend
- **Route**: `GET /api/v1/usage/project/:id` — `usageController.getProjectUsage()`
- **Controller**: `backend/src/controllers/usageController.js:19-30` returns:
  ```json
  {
    "success": true,
    "data": {
      "breakdown": [{ provider_type, model, total_in, total_out, total_cost, total_calls }],
      "totals": {
        "totalTokensIn": 12345,
        "totalTokensOut": 6789,
        "totalCost": 0.045,
        "totalCalls": 10
      }
    }
  }
  ```
- **Service**: `UsageLogger.getProjectUsage()` and `getTotalUsage()` return raw DB rows

### Existing Frontend
- **API Client**: `frontend/src/api/usage.js` — calls `GET /api/v1/usage/project/:id`
- **UI**: `frontend/src/views/ProjectDetail.vue:526-538` accesses wrong field names:
  ```javascript
  usage.total_requests    // → undefined (should be usage.totals.totalCalls)
  usage.total_cost        // → undefined (should be usage.totals.totalCost)
  usage.total_tokens      // → undefined (should be usage.totals.totalTokensIn + totalTokensOut)
  usage.avg_response_time_ms  // → undefined (not provided by backend)
  ```

### Gap Analysis
- Backend returns correct data structure with `totals` object
- Frontend accesses flat properties that don't exist
- All usage cards show 0 or undefined

---

## Design

### Option A: Fix Field Names in Frontend Template (Recommended)

**Changes in `frontend/src/views/ProjectDetail.vue` (usage tab section, ~lines 520-540):**

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

**Why this is the right choice**: Minimal change, fixes the root cause. Uses optional chaining (`?.`) for safety.

### Option B: Transform Backend Response in API Client

Add a transformation in `frontend/src/api/usage.js` to flatten/normalize the response.

**Pros**: Centralizes the transformation.
**Cons**: Hides the real data structure from the UI. The backend already returns well-structured data.
**Decision**: Option A is better — the UI should work with the actual API response shape.

### Option C: Change Backend to Match Frontend Expectations

Modify the backend controller to return `total_requests`, `total_cost`, etc.

**Pros**: Frontend would work without changes.
**Cons**: Breaks the backend's existing contract. Other consumers might depend on the current format.
**Decision**: Option A is better — fix the consumer, not the producer.

---

## Data Flow Diagram

```
[Backend] → GET /api/v1/usage/project/:id
  → { data: { totals: { totalCalls, totalCost, totalTokensIn, totalTokensOut } } }
  → [Frontend API client] → returns response.data
  → [Vue template] → usage.totals.totalCalls, usage.totals.totalCost, etc.
  → [User sees correct values]
```

---

## Dependencies

### Backend Dependencies
- None — no backend changes needed

### Frontend Dependencies
- `frontend/src/views/ProjectDetail.vue` — fix usage card field paths

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
- **[Risk]**: `usage` might be `null` or `undefined` before data loads
  **[Mitigation]**: Use optional chaining (`?.`) and fallback to `0`

### Integration Risks
- None

### Edge Cases
- Empty usage data (no API calls made) → totals will be 0, cards show "0"
- Very large token counts → display as-is (no formatting needed for integers)
- `avg_response_time_ms` card removal → users won't see response time (acceptable for now)

---

## Alternative Designs Considered

### Alternative 1: Transform in API client
- **Pros**: Centralized
- **Cons**: Hides real API structure, unnecessary layer
- **Decision**: Option A is simpler

### Alternative 2: Change backend to match frontend
- **Pros**: Frontend works without changes
- **Cons**: Breaks existing contract, other consumers affected
- **Decision**: Option A is correct — fix the broken consumer

---

*This design document guides implementation. The fix is updating field paths in the Vue template.*
