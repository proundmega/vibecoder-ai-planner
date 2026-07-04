# RS-11: Frontend Cypress Testing Setup

**Status**: planned
**Priority**: P4
**Effort**: Medium
**Author**: Lead Architect
**Date created**: 2026-06-06
**Date completed**: —
**PR**: —
**Branch**: —

**Dependencies**: RS-5 (User Management UI), RS-6 (Ticket Edit), RS-7 (Ticket Delete), RS-8 (AI Restrictions), RS-9 (Router Updates)

**References:**
- `01_ARCHITECT_REQUIREMENT.md` → "Testing Guidelines (MANDATORY)"
- `02_ARCHITECT_DESIGN.md` → "Frontend Testing with Cypress (MANDATORY)"

---

### a) Purpose

Add Cypress component testing and E2E testing to the frontend. The frontend currently has zero tests despite Vitest being installed. Cypress provides both component-level testing (isolated Vue components) and E2E testing (full browser flows with real backend). This covers the known bugs documented in AGENTS.md that ESLint doesn't catch.

**Why Cypress over Vitest for frontend:**
- Cypress runs in real browser — tests actual DOM, events, and network
- Visual debugging with time-travel and screenshots
- Custom commands for reusable test helpers
- E2E tests have no Vitest equivalent
- Component tests with `@cypress/vue` are mature for Vue 3

**Scope:**
1. Install dependencies and configure Cypress
2. Create custom commands for auth, CRUD, and role-based helpers
3. Write component tests for key Vue components
4. Write E2E tests for auth flows, project CRUD, ticket board, role guards
5. Integrate into CI pipeline
6. Fix known frontend bugs before tests pass

---

### b) Actions

#### Phase 1: Setup (Day 1)

1. Install dependencies:
   ```bash
   cd frontend && npm install --save-dev cypress @cypress/vue@4 cypress-localstorage-commands
   npx cypress open  # creates config and folder structure, then close it
   ```

2. Create `frontend/cypress.config.ts`:
   ```typescript
   import { defineConfig } from 'cypress';

   export default defineConfig({
     e2e: {
       baseUrl: 'http://localhost:3000',
       supportFile: 'cypress/support/e2e.ts',
       specPattern: 'cypress/e2e/**/*.cy.ts',
       viewportWidth: 1280,
       viewportHeight: 720,
       experimentalStudio: true,
       video: false,
       screenshotOnRunFailure: true,
     },
     component: {
       devServer: { framework: 'vue', bundler: 'vite' },
       supportFile: 'cypress/support/component.ts',
       specPattern: 'cypress/component/**/*.cy.ts',
       indexHtmlFile: 'cypress/support/component.html',
     },
   });
   ```

3. Create `cypress/support/e2e.ts`:
   ```typescript
   import './commands';

   Cypress.on('uncaught:exception', (err, runnable) => {
     // Ignore known Vue router navigation duplicated errors
     if (err.message.includes('NavigationDuplicated')) {
       return false;
     }
     return true;
   });
   ```

4. Create `cypress/support/component.ts`:
   ```typescript
   import { mount } from 'cypress/vue';
   import './commands';
   import '../fixtures/users.json';
   import '../fixtures/projects.json';
   import '../fixtures/tickets.json';

   Cypress.Commands.add('mount', (component, options = {}) => {
     return mount(component, options);
   });
   ```

5. Create `cypress/support/commands.ts`:
   ```typescript
   import 'cypress-localstorage-commands';

   // Auth commands
   Cypress.Commands.add('login', (email: string, password: string) => {
     cy.request({
       method: 'POST',
       url: '/api/auth/login',
       body: { email, password },
       failOnStatusCode: false,
     }).then((resp) => {
       if (resp.status === 200) {
         cy.setLocalStorage('vibecode_token', resp.body.token);
         cy.setLocalStorage('vibecode_user', JSON.stringify(resp.body.user));
         cy.visit('/dashboard');
       } else {
         cy.log(`Login failed for ${email}: ${resp.body.error}`);
       }
     });
   });

   Cypress.Commands.add('loginAsAdmin', () => {
     cy.login('alice@example.com', 'password123');
   });

   Cypress.Commands.add('loginAsMember', () => {
     cy.login('bob@example.com', 'password123');
   });

   Cypress.Commands.add('loginAsUser', () => {
     cy.login('agent@example.com', 'password123');
   });

   Cypress.Commands.add('logout', () => {
     cy.clearLocalStorage();
     cy.visit('/login');
   });

   // CRUD commands
   Cypress.Commands.add('createProject', (name: string, description = 'Test project') => {
     cy.loginAsAdmin();
     return cy.request({
       method: 'POST',
       url: '/api/projects',
       body: { name, description },
     }).then((resp) => resp.body.id);
   });

   Cypress.Commands.add('createTicket', (projectId: string, title: string, description = 'Test ticket') => {
     cy.loginAsAdmin();
     return cy.request({
       method: 'POST',
       url: '/api/tickets',
       body: { projectId, title, description },
     }).then((resp) => resp.body.id);
   });

   // Role-based commands
   Cypress.Commands.add('assertRoleAccess', (role: string, path: string, shouldAccess = true) => {
     if (shouldAccess) {
       cy.get(`[data-testid="role-${role}"]`).click();
       cy.visit(path);
       cy.url().should('include', path);
     } else {
       cy.get(`[data-testid="role-${role}"]`).click();
       cy.visit(path);
       cy.url().should('not.include', path);
     }
   });

   // Custom assertions
   Cypress.Commands.add('assertStatusBadge', (status: string) => {
     cy.get('[data-testid="status-badge"]').should('contain', status);
   });

   Cypress.Commands.add('assertRoleBadge', (role: string) => {
     cy.get('[data-testid="role-badge"]').should('contain', role);
   });
   ```

6. Create `cypress/fixtures/` with test data:
   - `users.json`: { alice, bob, charlie, agent }
   - `projects.json`: { testProject, anotherProject }
   - `tickets.json`: { backlogTicket, inProgressTicket, reviewTicket, doneTicket }

#### Phase 2: Fix Known Bugs (Day 1-2)

**Before writing tests, fix these 7 bugs from AGENTS.md:**

1. **`authStore.user` is a `ref`** — In `TicketBoard.vue`, `TicketDetail.vue`, `AIAssistant.vue`, change `authStore.user.role` to `authStore.user.value.role`
2. **`route.params.projectId` is undefined** — In `AIAssistant.vue`, change `route.params.projectId` to `route.params.id`
3. **Project selection has no `@change` handler** — In `TicketBoard.vue`, add `@change="loadTickets"` to project selector
4. **Drag-drop modifies throwaway object** — In `TicketBoard.vue`, fix `handleDrop` to use real ticket from `tickets.value` array
5. **`+ New Ticket` button is dead code** — Either implement ticket creation or remove the button
6. **Comments never persisted** — In `TicketDetail.vue`, call API to save comments instead of pushing to local ref
7. **`ProjectDetail.vue` is empty** — Implement basic project detail view or remove the route

#### Phase 3: Component Tests (Day 2-3)

Create `cypress/component/` tests for key Vue components:

1. **`Login.cy.ts`** — Test Login.vue component
   - Renders email and password fields
   - Shows validation error on empty submit
   - Shows error message on invalid credentials
   - Redirects to dashboard on success

2. **`TicketBoard.cy.ts`** — Test TicketBoard.vue component
   - Renders kanban columns (backlog, in_progress, review, done)
   - Renders tickets in correct columns based on status
   - Shows project selector dropdown
   - Shows/hide delete button based on role

3. **`TicketDetail.cy.ts`** — Test TicketDetail.vue component
   - Renders ticket title, description, status
   - Shows status transition buttons based on current status
   - Shows/hide edit and delete buttons based on role
   - Shows approval status badge when awaiting approval

4. **`UserModal.cy.ts`** — Test UserModal.vue component
   - Renders name, email, password, role fields for create mode
   - Renders name field only for edit mode
   - Role options depend on creator role:
     - project_admin → sees "member" and "user"
     - member → sees only "user"
     - user → no role selection

5. **`UserManagement.cy.ts`** — Test UserManagement.vue component
   - Renders user table with correct columns
   - Shows/hide "Create User" button based on role
   - Shows/hide delete/toggle buttons based on role
   - Filters users by role dropdown

#### Phase 4: E2E Tests (Day 3-4)

Create `cypress/e2e/` tests for full browser flows:

1. **`01-auth.cy.ts`** — Authentication flows
   - Login with valid credentials → redirect to dashboard
   - Login with invalid credentials → show error, stay on login
   - Register new account → login redirect
   - Logout → clear localStorage, redirect to login
   - Unauthenticated access → redirect to login

2. **`02-projects.cy.ts`** — Project CRUD
   - Create project → success, redirect to project list
   - List projects → show all projects
   - View project detail → show project info
   - Delete project → success, project removed from list

3. **`03-tickets.cy.ts`** — Ticket CRUD
   - Create ticket → success, ticket appears in backlog
   - Edit ticket → title/description/priority updated
   - Delete ticket → ticket removed
   - Drag-drop between columns → status updated
   - Status transitions via buttons → valid transitions work, invalid blocked

4. **`04-roles.cy.ts`** — Role-based access control
   - **Role-gated navigation:**
     - `project_admin` can access `/users` → 200
     - `member` can access `/users` → 200
     - `user` cannot access `/users` → redirects to `/dashboard`
     - `super_admin` can access `/super-admin/users` → 200
     - Non-super-admin cannot access `/super-admin/users` → redirects

   - **Ticket permissions:**
     - `project_admin` can delete any ticket → 200
     - `member` can delete any ticket → 200
     - `user` cannot delete others' tickets → Delete button not visible
     - `user` can delete own tickets → Delete button visible, succeeds

   - **User management:**
     - `project_admin` can create `member` and `user` accounts
     - `member` can create `user` accounts only
     - `member` cannot create `member` accounts → 400 error
     - `user` cannot create any user accounts → Create button not visible
     - `project_admin` can deactivate/reactivate users
     - `project_admin` can update user names

   - **Approval workflow:**
     - `user` changes ticket to `done` → creates approval request
     - `project_admin` can approve/reject pending approvals
     - `user` cannot approve/reject → 403
     - Approved ticket transitions to `done`
     - Rejected ticket stays in previous status

#### Phase 5: CI Integration (Day 4-5)

1. Update `frontend/package.json` scripts:
   ```json
   {
     "scripts": {
       "cypress:open": "cypress open",
       "cypress:component": "cypress run --component",
       "cypress:e2e": "cypress run --e2e --headless",
       "cypress:all": "cypress run --component --headless && cypress run --e2e --headless"
     }
   }
   ```

2. Add to `.github/workflows/ci.yml` frontend job:
   ```yaml
   - name: Install Cypress
     run: cd frontend && npm install --save-dev cypress @cypress/vue cypress-localstorage-commands
   - name: Cypress component tests
     run: |
       cd frontend
       npx cypress install
       npx cypress run --component --browser chrome
   - name: Cypress E2E tests
     run: |
       cd frontend
       npx cypress run --e2e --browser chrome --headless
   ```

3. Update `TICKETS.txt` and CI requirements in `01_ARCHITECT_REQUIREMENT.md`

---

### c) Dependencies

- `cypress` (E2E testing framework)
- `@cypress/vue@4` (Vue 3 component testing)
- `cypress-localstorage-commands` (for localStorage access in tests)
- Existing: Vue 3, Vite, Pinia, Vue Router
- Backend running on `localhost:3001` (for E2E tests via Vite proxy)

---

### d) Risks/Edge Cases

- **Known bugs will surface**: Cypress will immediately fail on AGENTS.md bugs (route param naming, drag-drop throwaway object, `authStore.user` ref access). **Must fix before E2E tests pass.**
- **localStorage in component tests**: Component tests run in isolation — localStorage mocking must be explicit via `cy.mockAuth()` command.
- **Vite proxy**: E2E tests hit the real backend via Vite dev proxy (`/api` → `localhost:3001`). Backend must be running during E2E tests.
- **Test data cleanup**: E2E tests create real data (users, projects, tickets). Use unique email prefixes per test run or clean up after each test.
- **Flaky drag-drop**: Cypress drag-drop can be flaky; use `cy.drag()` plugin or manual coordinate-based testing for kanban columns.
- **Auth store ref access**: `authStore.user` is a `ref` — component tests must use `authStore.user.value` when accessing properties.
- **Component test isolation**: Each component test must mock Pinia store and Vue Router — do not rely on global state.

---

### e) Testing Checklist

#### Component Tests
- [ ] `Login.vue` — renders fields, validation, error messages
- [ ] `TicketBoard.vue` — renders columns, tickets, project selector
- [ ] `TicketDetail.vue` — renders ticket info, status buttons, edit/delete
- [ ] `UserModal.vue` — renders form fields, role options based on creator
- [ ] `UserManagement.vue` — renders table, filters, role-based buttons

#### E2E Tests
- [ ] Login page renders correctly
- [ ] Registration flow works end-to-end
- [ ] Login redirects to dashboard
- [ ] Logout clears localStorage and redirects to login
- [ ] Project CRUD (create, read, update, delete)
- [ ] Ticket CRUD via board and detail view
- [ ] Drag-drop between kanban columns
- [ ] Status transitions via UI buttons
- [ ] Role-based access control (403 redirects)
- [ ] User management (admin/member views)
- [ ] Edit modal for tickets
- [ ] User modal for create/edit
- [ ] Approval workflow (create, approve, reject)

#### CI Checks
- [ ] `npm install` succeeds with Cypress dependencies
- [ ] `cypress run --component` passes all component tests
- [ ] `cypress run --e2e` passes all E2E tests
- [ ] CI pipeline runs Cypress tests headlessly

---

### f) CI Integration

**`.github/workflows/ci.yml` — add to frontend job:**
```yaml
- name: Install Cypress
  run: cd frontend && npm install --save-dev cypress @cypress/vue cypress-localstorage-commands
- name: Cypress component tests
  run: |
    cd frontend
    npx cypress install
    npx cypress run --component --browser chrome
- name: Cypress E2E tests
  run: |
    cd frontend
    npx cypress run --e2e --browser chrome --headless
```

**`frontend/package.json` — add scripts:**
```json
{
  "scripts": {
    "cypress:open": "cypress open",
    "cypress:component": "cypress run --component",
    "cypress:e2e": "cypress run --e2e --headless",
    "cypress:all": "cypress run --component --headless && cypress run --e2e --headless"
  }
}
```

---

### g) Migration from Vitest

- Keep Vitest for pure utility functions (if any exist)
- Component tests should migrate from Vitest to Cypress (`@cypress/vue` is the Vue-native equivalent)
- E2E tests have no Vitest equivalent — Cypress fills this gap entirely
- Remove `vitest` from `package.json` devDependencies once migration is complete

---

### h) Known Frontend Bugs (must be fixed before Cypress tests pass)

1. **`authStore.user` is a `ref`** — In `TicketBoard.vue`, `TicketDetail.vue`, `AIAssistant.vue`, change `authStore.user.role` to `authStore.user.value.role`
2. **`route.params.projectId` is undefined** — In `AIAssistant.vue`, change `route.params.projectId` to `route.params.id`
3. **Project selection has no `@change` handler** — In `TicketBoard.vue`, add `@change="loadTickets"` to project selector
4. **Drag-drop modifies throwaway object** — In `TicketBoard.vue`, fix `handleDrop` to use real ticket from `tickets.value` array
5. **`+ New Ticket` button is dead code** — Either implement ticket creation or remove the button
6. **Comments never persisted** — In `TicketDetail.vue`, call API to save comments instead of pushing to local ref
7. **`ProjectDetail.vue` is an empty placeholder** — Implement basic project detail view or remove the route

---

### i) Test File Structure

```
frontend/cypress/
├── cypress.config.ts              ← Cypress configuration
├── e2e/
│   ├── 01-auth.cy.ts              ← Authentication flows
│   ├── 02-projects.cy.ts          ← Project CRUD
│   ├── 03-tickets.cy.ts           ← Ticket CRUD, drag-drop, status transitions
│   └── 04-roles.cy.ts             ← Role-based access control
├── component/
│   ├── Login.cy.ts                ← Login component tests
│   ├── TicketBoard.cy.ts          ← TicketBoard component tests
│   ├── TicketDetail.cy.ts         ← TicketDetail component tests
│   ├── UserModal.cy.ts            ← UserModal component tests
│   └── UserManagement.cy.ts       ← UserManagement component tests
├── fixtures/
│   ├── users.json                 ← Test user data
│   ├── projects.json              ← Test project data
│   └── tickets.json               ← Test ticket data
└── support/
    ├── commands.ts                ← Custom Cypress commands
    ├── e2e.ts                     ← E2E support file
    ├── component.ts               ← Component support file
    └── component.html             ← Component test HTML template
```

---

*This ticket follows the 3 ARCHITECT templates:*
- *`01_ARCHITECT_REQUIREMENT.md` → Testing Guidelines, CI requirements, anti-patterns*
- *`02_ARCHITECT_DESIGN.md` → Role definitions, Cypress setup, known bugs*
- *`03_ARCHITECT_IMPLEMENTATION.md` → This template (purpose, actions, dependencies, risks, testing)*
