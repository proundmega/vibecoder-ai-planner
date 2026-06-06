# RS-11: Frontend Cypress Testing Setup

**Status**: planned
**Priority**: P4
**Effort**: Medium
**Dependencies**: RS-5 (User Management UI), RS-6 (Ticket Edit), RS-7 (Ticket Delete), RS-8 (AI Restrictions), RS-9 (Router Updates)

---

### a) Purpose

Add Cypress component testing and E2E testing to the frontend. The frontend currently has zero tests despite Vitest being installed. Cypress provides both component-level testing (isolated Vue components) and E2E testing (full browser flows with real backend). This covers the known bugs documented in AGENTS.md that ESLint doesn't catch.

**See `02_ARCHITECT_DESIGN.md` → "Frontend Testing with Cypress (MANDATORY)" for complete setup details, config files, custom commands, and CI integration.**

### b) Role-Specific Cypress Test Scenarios

The following role-based test scenarios are specific to this role system overhaul. Implement these in `cypress/e2e/04-roles.cy.ts` and `cypress/component/`:

**Role-gated navigation (E2E):**
- `project_admin` can access `/users` → 200, "Manage Users" visible
- `member` can access `/users` → 200, "Manage Users" visible
- `user` role cannot access `/users` → redirects to `/dashboard`
- `super_admin` can access `/super-admin/users` → 200
- Non-super-admin cannot access `/super-admin/users` → redirects

**Ticket permissions (E2E):**
- `project_admin` can delete any ticket → 200, ticket removed
- `member` can delete any ticket → 200, ticket removed
- `user` role cannot delete others' tickets → Delete button not visible
- `user` role can delete own tickets → Delete button visible, succeeds
- `user` role cannot access approval requests → 403

**User management (E2E):**
- `project_admin` can create `member` and `user` accounts
- `member` can create `user` accounts only
- `member` cannot create `member` accounts → 400 error
- `user` role cannot create any user accounts → Create button not visible
- `project_admin` can deactivate/reactivate users
- `project_admin` can update user names
- `user` role cannot update other users → 403

**Approval workflow (E2E):**
- `user` role changes ticket to `done` → creates approval request
- `project_admin` can approve/reject pending approvals
- `user` role cannot approve/reject → 403
- Approved ticket transitions to `done`
- Rejected ticket stays in previous status

**Component tests:**
- `UserModal.vue`: role selection options depend on creator role
  - `project_admin` → sees "member" and "user" options
  - `member` → sees only "user" option
  - `user` → no role selection (cannot create users)
- `TicketDetail.vue`: status buttons hidden/visible based on role
  - `user` role in `review` status → shows "Submit for Review" instead of "Mark Done"
  - `project_admin` role → shows full status transition buttons
- `TicketBoard.vue`: delete button visibility based on role
  - `user` role → no delete button on others' tickets
  - `member`/`project_admin` → delete button always visible

### c) Dependencies
- `cypress` (E2E testing framework)
- `@cypress/vue` (Vue 3 component testing)
- `cypress-localstorage-commands` (for localStorage access in tests)
- Existing: Vue 3, Vite, Pinia, Vue Router

### d) Risks/Edge Cases
- **Known bugs will surface**: Cypress will immediately fail on AGENTS.md bugs (route param naming, drag-drop throwaway object, `authStore.user` ref access). These must be fixed before E2E tests pass.
- **localStorage in component tests**: Component tests run in isolation — localStorage mocking must be explicit via `cy.mockAuth()` command.
- **Vite proxy**: E2E tests hit the real backend via Vite dev proxy (`/api` → `localhost:3001`). Backend must be running during E2E tests.
- **Test data cleanup**: E2E tests create real data (users, projects, tickets). Use unique email prefixes per test run or clean up after each test.
- **Flaky drag-drop**: Cypress drag-drop can be flaky; use `cy.drag()` plugin or manual coordinate-based testing for kanban columns.
- **Auth store ref access**: `authStore.user` is a `ref` — component tests must use `authStore.user.value` when accessing properties.

### e) Testing Checklist
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
- [ ] Component tests for all key views

### f) CI Integration

Add to `.github/workflows/ci.yml` frontend job:
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

### g) Migration from Vitest

- Keep Vitest for pure utility functions (if any exist)
- Component tests should migrate from Vitest to Cypress (`@cypress/vue` is the Vue-native equivalent)
- E2E tests have no Vitest equivalent — Cypress fills this gap entirely
- Remove `vitest` from `package.json` devDependencies once migration is complete

### h) Known Frontend Bugs (must be fixed before Cypress tests pass)

1. `authStore.user` is a `ref` — must use `authStore.user.value` in script code
2. `route.params.projectId` is undefined — should be `route.params.id`
3. Project selection in TicketBoard has no `@change` handler
4. Drag-drop modifies throwaway object instead of real ticket data
5. `+ New Ticket` button is dead code
6. Comments in TicketDetail are never persisted
7. `ProjectDetail.vue` is an empty placeholder
