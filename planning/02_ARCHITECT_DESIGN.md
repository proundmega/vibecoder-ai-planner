# 02_ARCHITECT_DESIGN.md — Role System Design Specification

**Status**: Working draft — not final. Use as reference when designing the role system.
**Author**: Lead Architect
**Scope**: Complete role system redesign, user management, ticket edit/delete, AI agent restrictions
**Note**: This is a design specification. See `TICKETS.txt` for current status. See `03_ARCHITECT_IMPLEMENTATION.md` for ticket implementation template.

---

## Role Definitions (Final)

| Role | Who | Permissions |
|------|-----|-------------|
| `super_admin` | Platform operators (manual DB only) | Full system access, view ALL users, activate/deactivate |
| `project_admin` | Humans registering via portal | Full project control: manage tickets, AI keys, create members/users |
| `member` | Team leads / reviewers | Manage tickets & planning, order AI agents, review work, create users |
| `user` | AI agents | Create tickets, update own tickets, update status, read AI tokens, NO delete, needs approval to move to done |

**Key rules:**
- `project_admin` can create `member` and `user` accounts
- `member` can create `user` accounts only
- `user` cannot create any other user
- `super_admin` created manually in DB only (no API endpoint)
- Default registration role: `project_admin`
- `user_created_by` tracks who created each user (null for self-registered)
- Roles are **immutable** once assigned — no `updateRole()` method

**Role hierarchy:**
```
super_admin > project_admin > member > user
```

---

## Database Schema

### Users Table Additions
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_created_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
```

### Role Constraint
```sql
ALTER TABLE users DROP CONSTRAINT IF EXISTS valid_roles;
ALTER TABLE users ADD CONSTRAINT valid_roles
  CHECK (role IN ('super_admin', 'project_admin', 'member', 'user'));
```

### Migration History
| File | Description | Status |
|------|-------------|--------|
| `001_create_tables.sql` | Base schema: users, projects, tickets, ai_keys, ai_actions | applied |
| `002_agents_schema.sql` | Agents table | applied |
| `003_role_system.sql` | Role system: is_active, user_created_by, approval_requests | applied |

### Approval Requests Table
```sql
CREATE TABLE IF NOT EXISTS approval_requests (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT REFERENCES tickets(id) ON DELETE CASCADE,
  requested_by BIGINT REFERENCES users(id),
  approved_by BIGINT REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  approved_at TIMESTAMP,
  CONSTRAINT valid_approval_status CHECK (status IN ('pending', 'approved', 'rejected'))
);
CREATE INDEX IF NOT EXISTS idx_approval_requests_ticket_id ON approval_requests(ticket_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status);
```

---

## Implementation Order

| Priority | Ticket | Effort | Blocks |
|----------|--------|--------|--------|
| P0 | RS-1 (DB Migration) | Small | All subsequent tickets |
| P0 | RS-2 (AuthService) | Medium | RS-3, RS-4 |
| P1 | RS-3 (Auth Middleware) | Medium | RS-4, RS-6, RS-7, RS-8 |
| P1 | RS-4 (User API) | Large | RS-5 |
| P2 | RS-5 (User UI) | Large | RS-9 |
| P2 | RS-6 (Ticket Edit) | Medium | RS-7 |
| P2 | RS-7 (Ticket Delete) | Medium | RS-8 |
| P3 | RS-8 (AI Restrictions) | Medium | RS-10 |
| P3 | RS-9 (Router Updates) | Small | RS-10 |
| P4 | RS-10 (Testing) | Large | — |
| P4 | RS-11 (Cypress) | Medium | — |

**Recommended approach**: Implement RS-1 through RS-4 first (foundation), then RS-5 through RS-7 (user/ticket management), then RS-8 through RS-9 (AI restrictions & routing), then RS-10 (testing), then RS-11 (Cypress E2E).

---

## Frontend Testing with Cypress (MANDATORY)

The frontend uses Cypress for both component testing and end-to-end browser testing. This is mandatory for all frontend code changes.

**See `TICKETS.txt` → RS-11 for implementation status.**

### Setup
```bash
cd frontend && npm install --save-dev cypress @cypress/vue@4 cypress-localstorage-commands
npx cypress open  # creates config and folder structure
```

### Config — `frontend/cypress.config.ts`
```typescript
import { defineConfig } from 'cypress';
export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000',
    supportFile: 'cypress/support/e2e.ts',
    specPattern: 'cypress/e2e/**/*.cy.ts',
    viewportWidth: 1280,
    viewportHeight: 720,
  },
  component: {
    devServer: { framework: 'vue', bundler: 'vite' },
    supportFile: 'cypress/support/component.ts',
    specPattern: 'cypress/component/**/*.cy.ts',
  },
});
```

### Test File Locations
- **E2E tests**: `frontend/cypress/e2e/` — full browser flows (auth, navigation, CRUD, role guards)
- **Component tests**: `frontend/cypress/component/` — isolated Vue component mounting
- **Fixtures**: `frontend/cypress/fixtures/` — JSON test data
- **Custom commands**: `frontend/cypress/support/commands.ts` — reusable test helpers

### Custom Commands Example
```typescript
Cypress.Commands.add('login', (email, password) => {
  cy.request('POST', '/api/auth/login', { email, password }).then((resp) => {
    cy.setLocalStorage('vibecode_token', resp.body.token);
    cy.setLocalStorage('vibecode_user', JSON.stringify(resp.body.user));
  });
  cy.visit('/dashboard');
});

Cypress.Commands.add('loginAsAdmin', () => cy.login('alice@example.com', 'password123'));
Cypress.Commands.add('createProject', (name) => {
  cy.loginAsAdmin();
  return cy.request('POST', '/api/projects', { name, description: 'Test' })
    .then((resp) => resp.body.id);
});
```

### Known Frontend Bugs (must be fixed before Cypress tests pass)
1. `authStore.user` is a `ref` — must use `authStore.user.value` in script code
2. `route.params.projectId` is undefined — should be `route.params.id`
3. Project selection in TicketBoard has no `@change` handler
4. Drag-drop modifies throwaway object instead of real ticket data
5. `+ New Ticket` button is dead code
6. Comments in TicketDetail are never persisted
7. `ProjectDetail.vue` is an empty placeholder

### Frontend Test Checklist per Ticket
- [ ] **Component rendering**: Key components mount without errors
- [ ] **User interactions**: Buttons, forms, modals respond correctly
- [ ] **Auth flows**: Login, register, logout work end-to-end
- [ ] **Role guards**: Unauthorized routes redirect correctly
- [ ] **CRUD operations**: Create, read, update, delete work in browser
- [ ] **Known bugs fixed**: AGENTS.md bugs do not cause test failures

### CI Integration
```yaml
- name: Install Cypress
  run: cd frontend && npm install --save-dev cypress @cypress/vue cypress-localstorage-commands
- name: Run Cypress component tests
  run: cd frontend && npx cypress run --component --browser chrome
- name: Run Cypress E2E tests
  run: cd frontend && npx cypress run --e2e --browser chrome --headless
```

### Migration from Vitest
- Keep Vitest for pure utility functions only
- Migrate component tests from Vitest to Cypress (`@cypress/vue`)
- E2E tests have no Vitest equivalent — Cypress fills this gap
- Remove `vitest` from `package.json` once migration is complete

---

## Testing Guidelines Reference

See `01_ARCHITECT_REQUIREMENT.md` → "Testing Guidelines (MANDATORY)" for:
- Unit and integration test structure
- Mocking strategy
- Testing checklist per ticket
- CI requirements
- Anti-patterns to avoid

---

*This document is a living specification. Review and update as the codebase evolves.*
