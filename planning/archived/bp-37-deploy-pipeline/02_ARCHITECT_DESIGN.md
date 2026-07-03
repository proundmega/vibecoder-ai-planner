# bp-37: Deployment Pipeline — Environments, Webhook Trigger, Rollback — Design

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Both

## Current State

Tickets end at `done` phase. There is no deploy concept, no environments table, no deployment history. The only way to deploy is manual — outside the system.

## Proposed Solution

### Database Migrations

**Migration 023: environments**
```sql
CREATE TABLE environments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(64) NOT NULL,
    webhook_url VARCHAR(512) NOT NULL,
    branch_pattern VARCHAR(128) DEFAULT '*',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_environments_project ON environments(project_id);
```

**Migration 024: deployments**
```sql
CREATE TABLE deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES tickets(id),
    environment_id UUID NOT NULL REFERENCES environments(id),
    status VARCHAR(16) DEFAULT 'pending',  -- pending → triggered → success | failed
    commit_sha VARCHAR(64),
    deployed_at TIMESTAMPTZ DEFAULT NOW(),
    rolled_back_at TIMESTAMPTZ,
    metadata JSONB
);

CREATE INDEX idx_deployments_ticket ON deployments(ticket_id);
CREATE INDEX idx_deployments_environment ON deployments(environment_id);
```

### DeployService.js

```javascript
class DeployService {
  async createEnvironment(projectId, name, webhookUrl, branchPattern) { ... }
  async listEnvironments(projectId) { ... }
  async deleteEnvironment(envId) { ... }

  async triggerDeploy(ticketId, environmentId) {
    // 1. Get ticket — verify status === 'done'
    // 2. Get environment
    // 3. Create deployment record (status: 'pending')
    // 4. Build webhook payload
    // 5. POST to environment.webhook_url with 10s timeout
    // 6. Update deployment status to 'triggered' (or 'failed' on error)
    // 7. Return deployment record
  }

  async rollbackDeployment(deploymentId) {
    // 1. Get deployment
    // 2. Verify not already rolled back
    // 3. POST webhook with { action: 'rollback', deployment_id }
    // 4. Update deployment.rolled_back_at
  }

  async getDeploymentHistory(ticketId, limit = 20, offset = 0) { ... }
  async updateDeploymentStatus(deploymentId, status) { ... }
}
```

### API Endpoints

**New file: backend/src/api/deployments.js**
```
GET    /api/v1/projects/:projectId/environments       → list environments
POST   /api/v1/projects/:projectId/environments       → create environment
DELETE /api/v1/environments/:id                        → delete environment
POST   /api/v1/tickets/:ticketId/deploy                → trigger deploy
POST   /api/v1/deployments/:id/rollback                → rollback
PATCH  /api/v1/deployments/:id/status                  → manual status update
GET    /api/v1/tickets/:ticketId/deployments           → deployment history
```

### Webhook Payload

```json
{
  "event": "deploy",
  "ticket_id": "uuid",
  "ticket_title": "Add user authentication",
  "branch": "feature/bp-37-deploy",
  "commit_sha": "abc123def456",
  "project_id": "uuid",
  "project_name": "My App",
  "environment": "staging",
  "environment_id": "uuid",
  "deployment_id": "uuid",
  "triggered_by": "user@example.com",
  "timestamp": "2026-06-27T10:00:00Z"
}
```

Rollback webhook payload:
```json
{
  "event": "rollback",
  "deployment_id": "uuid",
  "ticket_id": "uuid",
  "environment": "staging",
  "timestamp": "2026-06-27T11:00:00Z"
}
```

### Frontend: ProjectDetail.vue — Environments Tab

New tab in the project detail page:

```
┌─ Tickets ─ Chat ─ Settings ─ Environments ─┐
│                                              │
│  [ + Add Environment ]                       │
│                                              │
│  ┌── Staging ──────────────────────────┐    │
│  │ Webhook: https://.../deploy-staging   │    │
│  │ Branch: main                          │    │
│  │ Status: ● Active        [Delete]      │    │
│  │ Deployments: 12                      │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  ┌── Production ────────────────────────┐    │
│  │ Webhook: https://.../deploy-prod      │    │
│  │ Branch: release/*                     │    │
│  │ Status: ● Active        [Delete]      │    │
│  │ Deployments: 3                        │    │
│  └──────────────────────────────────────┘    │
```

### Frontend: Deploy Button in PhaseFlow.vue

When the ticket is in `done` phase, show:

```
┌────────────────────────────────────────┐
│  ✓ Ticket completed                    │
│                                        │
│  Deploy to: [Staging ▼]  [🚀 Deploy]  │
│                                        │
│  Last deployment: 2h ago (success)     │
│  [View history]                        │
└────────────────────────────────────────┘
```

### Frontend: DeployHistory.vue

```
Route: /projects/:id/tickets/:id/deployments

┌──────────────────────────────────────────┐
│  Deployment History                      │
│                                          │
│  #3  staging  success  10:32 AM  [Rbck] │
│  #2  staging  triggered 10:15 AM  [Rbck]│
│  #1  staging  failed    09:45 AM  [Retry]│
│                                          │
│  [Back to ticket]                        │
└──────────────────────────────────────────┘
```

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/migrations/023_environments.sql` | CREATE | environments table |
| `backend/src/migrations/024_deployments.sql` | CREATE | deployments table |
| `backend/src/migrations/apply.js` | MODIFY | Add 023, 024 to SQL_FILES |
| `backend/src/services/DeployService.js` | CREATE | Core deploy logic |
| `backend/src/api/deployments.js` | CREATE | REST endpoints |
| `backend/src/api/v1/index.js` | MODIFY | Mount deployment routes |
| `backend/src/validators/deployments.js` | CREATE | Joi schemas |
| `frontend/src/api/deployments.js` | CREATE | API client |
| `frontend/src/views/ProjectDetail.vue` | MODIFY | Add environments tab |
| `frontend/src/views/DeployHistory.vue` | CREATE | History view |
| `frontend/src/components/PhaseFlow.vue` | MODIFY | Add deploy section to done screen |
| `frontend/src/router/index.ts` | MODIFY | Add deployment history route |
