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

Fix the usage cards in the Usage & Billing tab so they display actual values instead of 0. The frontend accesses wrong field names that don't exist in the backend response.

---

### b) Actions

**Backend API already exists — no changes needed.**

#### Phase 1: Frontend UI

1. Fix `frontend/src/views/ProjectDetail.vue` — usage tab section (~lines 520-540):

   Update the usage cards to use correct field paths:
   ```vue
   <!-- "Total Requests" card → show totalCalls -->
   <div class="usage-value">{{ usage.totals?.totalCalls || 0 }}</div>
   
   <!-- "Total Cost" card → show totalCost -->
   <div class="usage-value">${{ (usage.totals?.totalCost || 0).toFixed(4) }}</div>
   
   <!-- "Total Tokens" card → show combined in+out -->
   <div class="usage-value">{{ (usage.totals?.totalTokensIn || 0) + (usage.totals?.totalTokensOut || 0) }}</div>
   
   <!-- Remove "Avg Response Time" card — backend doesn't provide this -->
   ```

2. Also update the card labels to be more descriptive:
   - "Total Requests" → "Total Calls"
   - "Total Tokens" → "Total Tokens" (kept, but shows combined in+out)

3. If you prefer to show tokens in and out separately (recommended):
   - Replace "Total Tokens" card with two cards: "Tokens In" and "Tokens Out"
   - `{{ usage.totals?.totalTokensIn || 0 }}` and `{{ usage.totals?.totalTokensOut || 0 }}`

#### Phase 2: Testing

4. Run frontend tests: `cd frontend && npm test -- --run`
5. Run frontend lint: `cd frontend && npm run lint`
6. Run frontend typecheck: `cd frontend && npm run typecheck`
7. Manual test: Navigate to Usage & Billing tab, verify cards show actual values

---

### c) Dependencies

- None — frontend-only fix

---

### d) Risks/Edge Cases

- **[Risk]**: `usage` is null/undefined before data loads
  **[Mitigation]**: Use optional chaining (`?.`) and `|| 0` fallback

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
frontend/src/views/ProjectDetail.vue  → fix usage card field paths
```

---

### h) Code Review Checklist

- [ ] Usage cards use `usage.totals.totalCalls`, `usage.totals.totalCost`, etc.
- [ ] Optional chaining used for safety (`?.`)
- [ ] Fallback to 0 for empty data
- [ ] All tests pass
- [ ] No backend changes needed

---

### i) Post-Deploy Verification

1. [ ] `cd frontend && npm test -- --run` passes
2. [ ] `cd frontend && npm run lint` passes
3. [ ] `cd frontend && npm run typecheck` passes
4. [ ] Navigate to Usage & Billing tab → cards show actual values (not 0)
5. [ ] Make an API call, refresh tab → values update
