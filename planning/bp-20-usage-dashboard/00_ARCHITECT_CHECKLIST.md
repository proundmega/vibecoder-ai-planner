# 00_ARCHITECT_CHECKLIST.md — Usage Dashboard

**Status**: planned
**Date created**: 2026-06-24

## Pre-Implementation Checklist

### Existing Infrastructure Audit
- [x] `GET /api/v1/usage/projects/:id/usage` exists — returns project usage data
- [x] `GET /api/v1/usage/users/me/usage` exists — returns current user's usage
- [x] `GET /api/v1/usage/pricing/models` exists — returns model pricing list
- [x] `UsageLogger.getProjectUsage()` exists — queries usage_logs by project
- [x] `UsageLogger.getUserUsage()` exists — queries usage_logs by user
- [x] `UsageLogger.getModelPricing()` exists — returns pricing data
- [x] Dashboard.vue exists at `/dashboard` with project list

### Risk Assessment
- Low risk — backend endpoints already exist, only frontend changes
- No database changes needed
- No permission changes needed (all existing routes use `verifyToken`)

### Files to Touch
**Frontend**:
1. `frontend/src/views/Dashboard.vue` — add "Usage" tab
2. `frontend/src/api/usage.js` — add `getUserUsage()` and `getModelPricing()` (already exist, just need frontend usage)

**Tests**:
3. `frontend/src/__tests__/usage.test.js` — already exists (6 tests)

### Validation Steps
- [ ] `cd frontend && npm run lint` — zero errors
- [ ] `cd frontend && npm run typecheck` — zero errors
- [ ] `cd frontend && npm test -- --run` — all pass
- [ ] `cd frontend && npm run build` — succeeds

### Rollback
Revert Dashboard.vue changes. No other files affected.

---

*Ready for requirement phase.*
