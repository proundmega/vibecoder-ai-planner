# 01_ARCHITECT_REQUIREMENT.md — Usage Dashboard

**Status**: planned
**Date created**: 2026-06-24

## Requirement

Add a "Usage" tab to the main Dashboard page showing per-project usage statistics and a model pricing reference table.

## Existing Infrastructure Audit

**What exists**:
- `GET /api/v1/usage/projects/:id/usage` — returns usage data for a project
- `GET /api/v1/usage/users/me/usage` — returns current user's usage (no frontend consumer)
- `GET /api/v1/usage/pricing/models` — returns model pricing list (no frontend consumer)
- `Dashboard.vue` at `/dashboard` — shows project list

**What's missing**:
- No UI to display usage data
- `getUserUsage()` and `getModelPricing()` exist in API client but are never imported
- `getProjectUsage()` is used in ProjectDetail.vue (per-project usage) but not in Dashboard

## Scope

**In scope**:
1. Add "Usage" tab to Dashboard.vue
2. Show per-project usage stats (total tokens, total cost, top models)
3. Show model pricing reference table
4. Add `getUserUsage()` and `getModelPricing()` to API client (already exist, just wire them up)

**Out of scope**:
- Per-user billing details (that's the Billing Dashboard)
- Real-time usage updates
- Usage alerts or thresholds
- Usage export/download

## Acceptance Criteria

- [ ] Dashboard has a "Usage" tab alongside existing tabs
- [ ] Usage tab shows per-project usage summary (tokens, cost)
- [ ] Usage tab shows model pricing table
- [ ] `getUserUsage()` is wired to the API client (already exists)
- [ ] `getModelPricing()` is wired to the API client (already exists)
- [ ] All tests pass, lint clean, build succeeds

## Testing Checklist

- [ ] Existing `usage.test.js` covers all API functions (already done)
- [ ] Lint passes with zero errors
- [ ] Typecheck passes with zero errors
- [ ] All existing tests still pass
- [ ] Build succeeds

## CI Requirements (MANDATORY)

- `cd frontend && npm run lint` — zero errors
- `cd frontend && npm run typecheck` — zero errors
- `cd frontend && npm test -- --run` — all tests pass
- `cd frontend && npm run build` — succeeds
