# 00_ARCHITECT_CHECKLIST.md — Billing Dashboard

**Status**: completed
**Date created**: 2026-06-24

## Pre-Implementation Checklist

### Existing Infrastructure Audit
- [x] `GET /api/v1/billing/projects/:id/billing` exists — returns project billing data
- [x] `GET /api/v1/billing/users/me/billing` exists — returns current user's billing data
- [x] `BillingService.getProjectBilling()` exists — queries project_billing table
- [x] `BillingService.getUserBilling()` exists — queries user_pricing_tiers + usage_logs
- [x] `BillingService.getProjectBillingRange()` exists — date range billing
- [x] `BillingService.getUsageSince()` exists — billing since a date

### Risk Assessment
- Low risk — backend endpoints already exist, only frontend changes
- No database changes needed
- Permission: `project_admin` can access their own project billing

### Files to Touch
**Frontend**:
1. `frontend/src/views/BillingDashboard.vue` — NEW view
2. `frontend/src/router/index.ts` — add `/billing` route
3. `frontend/src/api/billing.js` — add `getUserBilling()` usage (already exists as dead code)

**Tests**:
4. `frontend/src/__tests__/billing.test.js` — already exists (4 tests)

### Validation Steps
- [ ] `cd frontend && npm run lint` — zero errors
- [ ] `cd frontend && npm run typecheck` — zero errors
- [ ] `cd frontend && npm test -- --run` — all pass
- [ ] `cd frontend && npm run build` — succeeds

### Rollback
Revert new files and route changes. No backend changes.

---

*Ready for requirement phase.*
