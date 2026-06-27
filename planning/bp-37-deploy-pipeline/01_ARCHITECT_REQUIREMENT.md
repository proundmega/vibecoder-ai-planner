# bp-37: Deployment Pipeline — Environments, Webhook Trigger, Rollback

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Both
**Priority**: P1
**Effort**: Medium

## Problem Statement

When a ticket reaches `done`, there's no deployment mechanism. The code is merged and approved but never delivered to any environment. Teams need to define environments (staging, production), trigger deployments with a single click, and roll back if something goes wrong. Without a deployment pipeline, the system stops at code review — value is never shipped.

## Scope

- **In scope**: Environments CRUD per project, deploy trigger from `done` tickets, webhook POST to configured URL, deployment history, rollback endpoint, frontend environment management UI, deploy button in PhaseFlow.vue
- **Out of scope**: CI/CD pipeline integration, automatic deployment on phase transition, webhook receiver/callback endpoint, deployment status polling from CI

## Acceptance Criteria

- [ ] Migration 023 creates `environments` table with project FK and webhook URL
- [ ] Migration 024 creates `deployments` table with ticket FK and status tracking
- [ ] Users can create/list/delete environments per project (name, webhook URL, branch pattern)
- [ ] "Deploy to [environment]" button appears on `done` phase tickets
- [ ] Backend POSTs to the environment's webhook URL with ticket metadata JSON
- [ ] Deployment record is created with status `pending` → automatically set to `triggered` after webhook POST
- [ ] Rollback endpoint POSTs to the same webhook with `{ action: "rollback", deployment_id }`
- [ ] Frontend shows deployment history with timestamps and status
- [ ] Frontend polls deployment status (or provides manual refresh)

## Known Unknowns

- **Webhook delivery guarantee**: If the webhook URL is unreachable, the deployment stays `pending`. Need a timeout (10s) and failure status.
- **Status callback**: The deploy pipeline in the external system (e.g., Vercel, GitHub Actions) won't call back to us yet. Status must be manually updated or polled.

## Decisions Required

1. **How to track deployment status without webhook callback?**
   - Option A: Manual status toggle — user clicks "Mark as successful/failed"
   - Option B: Frontend polls an external status API (tight coupling, fragile)
   - **Recommendation**: Option A — simplest. Add a `PATCH /deployments/:id/status` endpoint for manual updates. Webhook callback can be added later.

2. **Where to put the deploy button?**
   - Option A: In PhaseFlow.vue `done` screen as the primary CTA
   - Option B: In a separate tab on ProjectDetail.vue
   - **Recommendation**: Both — deploy button in PhaseFlow.vue for convenience, environment management in ProjectDetail.vue for admin.

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/migrations/023_environments.sql` | CREATE | Environments table |
| `backend/src/migrations/024_deployments.sql` | CREATE | Deployments table |
| `backend/src/services/DeployService.js` | CREATE | Core deploy logic |
| `backend/src/api/deployments.js` | CREATE | REST endpoints |
| `backend/src/api/v1/index.js` | MODIFY | Mount deploy routes |
| `backend/src/validators/deployments.js` | CREATE | Joi schemas for deploy payloads |
| `frontend/src/api/deployments.js` | CREATE | API client |
| `frontend/src/views/ProjectDetail.vue` | MODIFY | Add environments tab |
| `frontend/src/views/DeployHistory.vue` | CREATE | Deployment history view |
| `frontend/src/components/PhaseFlow.vue` | MODIFY | Add deploy button to done screen |

## Dependencies

- **Depends on this**: bp-26 (phase machine — needs `done` phase for deploy trigger), bp-34/35 (code review — deploy should only be available for reviewed + approved tickets)

## Performance Considerations

- Webhook POSTs are external network calls. Timeout at 10 seconds to avoid blocking the request.
- Deployment history should be paginated (20 per page default).
