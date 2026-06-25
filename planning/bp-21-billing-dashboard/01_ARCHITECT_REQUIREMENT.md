# 01_ARCHITECT_REQUIREMENT.md — Billing Dashboard

**Status**: completed
**Date created**: 2026-06-24

## Requirement

Create a standalone Billing Dashboard screen showing the current user's billing information. This is a private/sensitive view restricted to project_admin role for their own projects.

## Existing Infrastructure Audit

**What exists**:
- `GET /api/v1/billing/projects/:id/billing` — project billing data
- `GET /api/v1/billing/users/me/billing` — user billing data (no frontend consumer)
- `BillingService` has `getProjectBilling()`, `getUserBilling()`, `getProjectBillingRange()`, `getUsageSince()`
- `frontend/src/api/billing.js` has `getProjectBilling()` (used in ProjectDetail.vue) and `getUserBilling()` (dead)

**What's missing**:
- No billing dashboard screen
- `getUserBilling()` API function exists but is never imported
- No billing route in router

## Scope

**In scope**:
1. New standalone page: `/billing`
2. Show user's billing summary (total cost, billing period, payment status)
3. Show per-project billing breakdown
4. Restrict access to project_admin role

**Out of scope**:
- Payment method management
- Invoice download
- Billing history beyond current period
- Multi-currency support

## Acceptance Criteria

- [ ] New page at `/billing` accessible from navigation
- [ ] Shows user billing summary
- [ ] Shows per-project billing breakdown
- [ ] Only accessible by project_admin role
- [ ] Redirects non-admin users to dashboard
- [ ] All tests pass, lint clean, build succeeds

## Testing Checklist

- [ ] Existing `billing.test.js` covers all API functions (already done)
- [ ] Lint passes with zero errors
- [ ] Typecheck passes with zero errors
- [ ] All existing tests still pass
- [ ] Build succeeds

## CI Requirements (MANDATORY)

- `cd frontend && npm run lint` — zero errors
- `cd frontend && npm run typecheck` — zero errors
- `cd frontend && npm test -- --run` — all tests pass
- `cd frontend && npm run build` — succeeds
