# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: {{planned | in_progress | completed}}
**Date created**: 2026-06-19
**Date completed**: {{YYYY-MM-DD}}
**Author**: AI Assistant
**Scope**: Frontend
**Priority**: P1
**Effort**: Small

---

## Requirement

Fix the field name mismatch in the Usage API response. The frontend accesses `usage.total_requests`, `usage.total_cost`, `usage.total_tokens`, `usage.avg_response_time_ms` but the backend returns `data.totals.totalCalls`, `data.totals.totalCost`, `data.totals.totalTokensIn + totalTokensOut`, and does not return `avg_response_time_ms`.

**Current behavior**: Usage cards show 0 for all values because the fields don't exist.
**Expected behavior**: Usage cards display actual token counts, cost, and call counts from the backend.

---

## Existing Infrastructure Audit

**CRITICAL**: Before planning, audit what already exists. Do NOT create new code if existing code can be extended.

### Backend API Check
- [x] API route exists: `backend/src/api/usage.js` — YES
- [x] Controller exists: `backend/src/controllers/usageController.js` — YES
- [x] Service exists: `backend/src/services/UsageLogger.js` — YES
- [x] Route is mounted: `backend/src/api/v1/index.js:35` — YES (`/usage`)
- [x] OpenAPI JSDoc annotations exist — YES

### Frontend API Client Check
- [x] API client exists: `frontend/src/api/usage.js` — YES
- [x] API client functions cover all needed endpoints — YES
- [x] API client follows existing patterns — YES

### Frontend UI Check
- [x] View component exists: `frontend/src/views/ProjectDetail.vue` — YES (Usage & Billing tab)
- [x] Existing tab where this feature lives — YES (Usage & Billing tab at line ~517)
- [x] Existing pattern to extend — YES (usage cards)

### Integration Check
- [x] Frontend API client can call existing backend endpoints — YES (paths are correct)
- [ ] Response shapes match — NO (frontend accesses wrong field names)
- [x] Auth tokens are used correctly — YES
- [x] Error handling matches existing patterns — YES

### Key Insight

This is a **FRONTEND-ONLY fix**. The backend returns the correct data structure:
```json
{
  "success": true,
  "data": {
    "breakdown": [...],
    "totals": {
      "totalTokensIn": 12345,
      "totalTokensOut": 6789,
      "totalCost": 0.045,
      "totalCalls": 10
    }
  }
}
```

The frontend accesses `usage.total_requests`, `usage.total_cost`, etc. which don't exist. Fix the frontend to use the correct field names.

---

## Scope

### In Scope
- [ ] Update `frontend/src/views/ProjectDetail.vue` usage cards to use correct field paths:
  - `usage.total_requests` → `usage.totals.totalCalls`
  - `usage.total_cost` → `usage.totals.totalCost`
  - `usage.total_tokens` → `usage.totals.totalTokensIn + usage.totals.totalTokensOut`
  - `usage.avg_response_time_ms` → remove or set to 0 (backend doesn't provide this)

### Out of Scope
- Backend changes to the usage response structure
- Adding avg_response_time_ms to the backend (would require storing request duration in usage_logs)
- New API endpoints

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `frontend/src/views/ProjectDetail.vue` | MODIFY | Fix usage card field paths in Usage & Billing tab (~lines 520-540) |
| `database` | NONE | No schema changes |
| `config` | NONE | No env var changes |

---

## Known Unknowns

1. **[Exact line numbers]**: The usage tab section line numbers may have shifted if other changes were made to ProjectDetail.vue. **Resolution**: grep for `usage.total_requests` or `usage.total_cost` in ProjectDetail.vue to find the actual location.
2. **[Token display preference]**: Should tokens be shown as one combined value or two separate cards? **Resolution**: Per the design doc, show two separate cards ("Tokens In" and "Tokens Out").

---

## Important Design Decisions

**DECISION POINTS**:

1. **How to display total tokens?** — Backend returns `totalTokensIn` and `totalTokensOut` separately. Options:
   - A) Show them as two separate cards (recommended)
   - B) Sum them into one card
   - C) Show only `totalTokensIn`
   
   **Recommendation**: Show two cards — "Tokens In" and "Tokens Out" — to match the backend's granular data.

2. **What to do with avg_response_time_ms?** — Backend doesn't return this. Options:
   - A) Remove the card entirely
   - B) Keep the card but show "N/A"
   - C) Add avg_response_time_ms to the backend (requires schema change)
   
   **Recommendation**: Remove the card. It's not critical for the usage overview and adding it to the backend is a separate enhancement.

---

## Acceptance Criteria

1. [ ] [Frontend UI] Usage card "Total Calls" displays `usage.totals.totalCalls`
2. [ ] [Frontend UI] Usage card "Total Cost" displays `usage.totals.totalCost` (formatted as currency)
3. [ ] [Frontend UI] Usage card "Tokens In" displays `usage.totals.totalTokensIn`
4. [ ] [Frontend UI] Usage card "Tokens Out" displays `usage.totals.totalTokensOut`
5. [ ] [Frontend UI] The "Avg Response Time" card is removed (backend doesn't provide this)
6. [ ] [Frontend UI] When usage data is empty/zero, cards show 0 (not undefined errors)
7. [ ] [Both] All tests pass (`npm test` in frontend)
8. [ ] [Both] Linting passes (`npm run lint` in frontend)
9. [ ] [Both] Frontend typecheck passes (`npm run typecheck`)

---

## Out of Scope

- Adding `avg_response_time_ms` to the backend usage API
- Adding response time tracking to `usage_logs` table
- Backend changes to the usage response structure
- New API endpoints for usage
- Modifying the breakdown array display (already works correctly)

---

## Performance Considerations

- Expected load: N/A (this is a template field fix, no new queries)
- N+1 queries to avoid: N/A
- Caching strategy: N/A
- Pagination needed: N/A

---

## Security Considerations

- Authentication required: YES (existing — usage endpoints are behind auth)
- Authorization check: YES (existing — project-level access control)
- Input validation: N/A (no input changes, only output field references)
- Sensitive data handling: No change — usage data contains no secrets

---

## Testing Checklist

### Frontend Tests
- [ ] Unit tests: `npm test -- --run` — no regressions
- [ ] Manual verification: Navigate to Usage & Billing tab, verify cards show correct values

### Frontend Contract Tests
- [ ] `frontend/src/__tests__/api-contract.test.ts` — verify usage response shape includes `totals.totalCalls`, `totals.totalCost`, `totals.totalTokensIn`, `totals.totalTokensOut`
- [ ] `frontend/src/api/validator.ts` — verify usage response schema expects `totals` object

### CI Requirements
- [ ] `npm run lint` — frontend lint passes
- [ ] `npm run typecheck` — frontend typecheck passes

---

## Anti-Patterns to Avoid

- ❌ **Changing the backend response** — the backend response is correct and well-structured
- ❌ **Creating a transformation layer** — just fix the field names in the template
- ❌ **Ignoring the breakdown array** — the breakdown data is already displayed correctly (it's just the totals cards that are broken)
