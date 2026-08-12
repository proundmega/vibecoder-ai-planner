# bp-117: Route Mount Audit Script

## Ticket Information
- **ID**: bp-117
- **Priority**: P2 (developer experience)
- **Type**: Infrastructure
- **Scope**: Backend (script + tests)

## Problem Statement

The backend has a complex route mounting hierarchy with inline routes and `router.use()` mounts. Route ordering is critical — inline sub-routes must be defined **before** `router.use()` mounts that could shadow them. The fg-13 ticket (PR #82) fixed route ordering issues but the fix was manual and error-prone. There is no automated check to prevent future "route never mounted" regressions.

### Current Issues

1. **Orphaned routers**: `ticketAttachment.js` and `ticketPlanning.js` exist on disk but are never imported/mounted in `v1/index.js`
2. **Route ordering fragility**: Inline routes in `v1/index.js` have comments like "must be before router.use" but no automated enforcement
3. **Permission code validation**: `requireAnyPermission('CODE')` calls could reference non-existent permission codes (fg-13 had `PROJECT_ADMIN` as a permission code instead of `TICKET_READ`)

## Solution

Create a Node.js audit script `backend/scripts/audit-routes.js` that:

### 1. Orphaned Router Detection

- Scan `backend/src/api/*.js` for router files
- Cross-reference against `require()` calls in `v1/index.js`
- Report files that are not imported (excluding special files: openapi-spec, openapi-metrics, csp-report, pool, terminal)

### 2. Route Ordering Validation

- Parse `v1/index.js` to extract inline route definitions and `router.use()` mount points
- For each mount `router.use('/prefix', router)`, verify no inline route under that prefix is defined **after** the mount
- Report violations with line numbers

### 3. Permission Code Validation

- Parse all `requireAnyPermission('CODE')` and `requireAnyPermission(['CODE1', 'CODE2'])` calls in `v1/index.js`
- Cross-reference against the 26 permission codes in `005_permission_system.sql`
- Report any codes not in the catalog

### 4. Mount Point Completeness

- For each `router.use('/', router)` (milestones, deployments), verify the sub-router paths match frontend expectations
- Report mismatches

## Script Output

```
=== Route Mount Audit ===

[ORPHANED] ticketAttachment.js — not imported in v1/index.js (superseded by inline routes)
[ORPHANED] ticketPlanning.js — not imported in v1/index.js (superseded by inline routes)

[ORDERING OK] Template routes before /projects mount
[ORDERING OK] Attachment routes before /tickets mount
[ORDERING OK] Planning usage routes before :fileKey catch-all

[PERMISSION OK] All permission codes exist in catalog
[PERMISSION OK] 26/26 permissions referenced

[COMPLETE] Milestone routes match frontend expectations
[COMPLETE] Deployment routes match frontend expectations

=== Summary ===
Orphaned routers: 2 (expected — superseded)
Ordering violations: 0
Permission mismatches: 0
Mount mismatches: 0
```

## Implementation Plan

### 1. Create audit-routes.js script

- Use AST parsing (acorn) or regex to extract route definitions
- Cross-reference against permission catalog
- Output structured report

### 2. Add npm script

```json
"scripts": {
  "audit:routes": "node scripts/audit-routes.js"
}
```

### 3. Add to CI (optional)

Add to Jenkinsfile as a lightweight check (no DB needed).

## Files to Create

| File | Purpose |
|------|---------|
| `backend/scripts/audit-routes.js` | Main audit script |
| `backend/src/__tests__/routeAudit.test.js` | Unit tests for audit logic |

## Out of Scope

- Auto-fixing route ordering issues (report only)
- Removing orphaned router files (manual cleanup)
- Adding permission codes (separate ticket)

## Deferred Improvements Found

| # | From Ticket | Improvement | Category | Suggested Next Ticket |
|---|-------------|-------------|----------|----------------------|
| 1 | bp-112 | Java agent unit tests | Testing | bp-118-java-agent-unit-tests |
| 2 | bp-113 | Route-level permission guards | Security | bp-115-route-permission-guards |
| 3 | bp-113 | Planning file usage UI | UX | bp-116-planning-file-usage-ui |
| 4 | bp-99 | Runtime provider config hot reload | Feature | bp-119-provider-config-hot-reload |
