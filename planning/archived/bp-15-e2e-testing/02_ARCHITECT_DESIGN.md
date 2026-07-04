# 02_ARCHITECT_DESIGN.md — E2E Testing Infrastructure for Frontend

**Status**: planned
**Date created**: 2026-06-20
**Author**: AI Assistant

---

## Problem Statement

Frontend bugs are creeping in with no way to run end-to-end tests locally or in CI. Existing Cypress tests cover auth, projects, tickets, and roles but have significant gaps: no registration test, no user management test, no ticket assignment test, and no test data seeding mechanism. Tests depend on pre-existing database state, making them fragile and non-reproducible.

---

## Current State

### Existing Cypress Tests (4 e2e specs, ~27 tests)

```
cypress/e2e/
  01-auth.cy.ts      — Login, logout, redirect, invalid credentials
  02-projects.cy.ts   — Create, list, navigate, delete projects
  03-tickets.cy.ts    — Create, edit, status change, comment, delete, filter tickets
  04-roles.cy.ts      — RBAC: /users access, /super-admin/users, ticket permissions
```

### Existing Custom Commands

```typescript
// cypress/support/commands.ts
cy.login(email, password)          // API login, stores token in localStorage
cy.loginAsAdmin()                  // Alias for alice@example.com
cy.logout()                        // Clears localStorage
cy.createProject(name, desc)       // API POST /api/projects, returns project ID
cy.createTicket(projectId, title)  // API POST /api/tickets, returns ticket ID
cy.assertStatusBadge(status)       // Custom assertion for status badges
cy.assertRoleBadge(role)           // Custom assertion for role badges
```

### Existing Fixtures (JSON only, not used by tests)

```
cypress/fixtures/
  users.json    — 4 users (alice, bob, charlie, deactivated)
  projects.json — 2 projects
  tickets.json  — 4 tickets
```

### What's Missing

| Gap | Impact |
|-----|--------|
| No `cy.register()` command | Cannot test registration flow end-to-end |
| No `cy.createUser()` command | Cannot test user creation from UI |
| No seed script | Tests depend on pre-existing DB state (brittle) |
| No registration test | `Register.vue` is untested |
| No user management test | `UserManagement.vue` is untested |
| No ticket assignment test | Ticket assignment workflow is untested |
| No full workflow test | No test covering register → create user → assign ticket |

### Backend API Endpoints (All Exist, No Changes Needed)

```
POST /api/auth/register        — Create account (name, email, password)
POST /api/users                — Create user (admin only)
PUT  /api/users/:id            — Update user (admin only)
PATCH /api/users/:id/toggle-active — Toggle active/inactive
DELETE /api/users/:id          — Delete user (admin only)
PUT  /api/tickets/:id          — Update ticket (assignee, status, etc.)
GET  /api/v1/permissions/:role — Get permissions for a role
```

---

## Design

### Architecture

```
Test Run (npm run cypress:e2e)
    ↓
cypress/support/seed.ts (global before hook)
    ↓
POST /api/auth/register → alice@example.com (project_admin)
POST /api/auth/register → bob@example.com (member)
POST /api/auth/register → charlie@example.com (user)
POST /api/auth/login    → get tokens for all 3 users
POST /api/users         → create additional test users (if needed)
POST /api/projects      → create test project
POST /api/tickets       → create test tickets
    ↓
Tests run (01-07)
    ↓
Tests use timestamp-based names to avoid conflicts
    ↓
After all tests: seed runs again to clean up (or rely on test isolation)
```

### Custom Commands

```typescript
// cypress/support/commands.ts (NEW commands added)

Cypress.Commands.add('register', (name, email, password) => {
  return cy.request({
    method: 'POST',
    url: '/api/auth/register',
    body: { name, email, password },
    failOnStatusCode: false,
  }).then((resp) => {
    if (resp.status === 201) {
      cy.setLocalStorage('vibecode_token', resp.body.token);
      cy.setLocalStorage('vibecode_user', JSON.stringify(resp.body.user));
      return resp.body.user;
    }
    throw new Error(`Registration failed for ${email}: ${resp.body.error || 'Unknown error'}`);
  });
});

Cypress.Commands.add('createUser', (name, email, password, role = 'member') => {
  // Login as admin first
  cy.login('alice@example.com', 'password123');
  return cy.request({
    method: 'POST',
    url: '/api/users',
    body: { name, email, password, role },
    failOnStatusCode: false,
  }).then((resp) => {
    if (resp.status === 201) return resp.body.user;
    throw new Error(`Failed to create user: ${resp.body.error || 'Unknown error'}`);
  });
});
```

### Seed Script

```typescript
// cypress/support/seed.ts (NEW file)

interface SeedUser {
  name: string;
  email: string;
  password: string;
  role: string;
  id?: string;
}

interface SeedProject {
  name: string;
  id?: string;
}

interface SeedTicket {
  title: string;
  projectId: string;
  status: string;
  id?: string;
}

const TIMESTAMP = Date.now();

async function seed() {
  // 1. Register base users
  const users: SeedUser[] = [
    { name: `Alice Admin ${TIMESTAMP}`, email: `alice-test-${TIMESTAMP}@example.com`, password: 'password123', role: 'project_admin' },
    { name: `Bob Member ${TIMESTAMP}`, email: `bob-test-${TIMESTAMP}@example.com`, password: 'password123', role: 'member' },
    { name: `Charlie User ${TIMESTAMP}`, email: `charlie-test-${TIMESTAMP}@example.com`, password: 'password123', role: 'user' },
  ];

  const registeredUsers: SeedUser[] = [];
  for (const user of users) {
    const resp = await cy.request({
      method: 'POST',
      url: '/api/auth/register',
      body: { name: user.name, email: user.email, password: user.password },
      failOnStatusCode: false,
    });
    if (resp.status === 201) {
      const userData = resp.body.user || resp.body.data?.user;
      registeredUsers.push({ ...user, id: userData.id });
    }
  }

  // 2. Login and get tokens
  const tokens: Record<string, string> = {};
  for (const user of registeredUsers) {
    const loginResp = await cy.request({
      method: 'POST',
      url: '/api/auth/login',
      body: { email: user.email, password: user.password },
      failOnStatusCode: false,
    });
    if (loginResp.status === 200) {
      tokens[user.email] = loginResp.body.token;
    }
  }

  // 3. Create project (using admin token)
  const adminEmail = registeredUsers[0].email;
  const projectResp = await cy.request({
    method: 'POST',
    url: '/api/projects',
    body: { name: `Test Project ${TIMESTAMP}`, description: 'Created by Cypress seed' },
    headers: { Authorization: `Bearer ${tokens[adminEmail]}` },
    failOnStatusCode: false,
  });

  let projectId: string;
  if (projectResp.status === 201) {
    projectId = projectResp.body.id || projectResp.body.data?.id;
  }

  // 4. Create tickets (using admin token)
  if (projectId) {
    await cy.request({
      method: 'POST',
      url: '/api/tickets',
      body: { projectId, title: `Ticket 1 - Backlog ${TIMESTAMP}`, description: 'Test ticket', status: 'backlog' },
      headers: { Authorization: `Bearer ${tokens[adminEmail]}` },
      failOnStatusCode: false,
    });
    await cy.request({
      method: 'POST',
      url: '/api/tickets',
      body: { projectId, title: `Ticket 2 - In Progress ${TIMESTAMP}`, description: 'Test ticket', status: 'in_progress' },
      headers: { Authorization: `Bearer ${tokens[adminEmail]}` },
      failOnStatusCode: false,
    });
  }

  return { users: registeredUsers, projectId, tokens };
}

export { seed };
```

### Test Files

#### `cypress/e2e/05-registration.cy.ts`

```typescript
describe('Registration Flow', () => {
  beforeEach(() => {
    cy.visit('/register');
  });

  it('should render registration page with name, email, and password fields', () => {
    cy.get('h1').should('contain', 'Create Account');
    cy.get('input[placeholder="Name"]').should('exist');
    cy.get('input[placeholder="Email"]').should('exist');
    cy.get('input[placeholder*="Password"]').should('exist');
    cy.get('button[type="submit"]').should('exist');
  });

  it('should register a new account and redirect to dashboard', () => {
    const timestamp = Date.now();
    cy.register(`Test User ${timestamp}`, `test-${timestamp}@example.com`, 'password123');
    cy.url().should('include', '/dashboard');
    cy.getLocalStorage('vibecode_token').should('exist');
    cy.getLocalStorage('vibecode_user').then((userStr) => {
      const user = JSON.parse(userStr || '{}');
      expect(user.email).to.include('test-');
    });
  });

  it('should show error on invalid registration (weak password)', () => {
    cy.get('input[placeholder="Name"]').type('Bad Password User');
    cy.get('input[placeholder="Email"]').type(`badpw-${Date.now()}@example.com`);
    cy.get('input[placeholder*="Password"]').type('short');
    cy.get('button[type="submit"]').click();
    cy.get('.error').should('exist');
  });

  it('should redirect to login from registration page', () => {
    cy.get('a[href="/login"]').should('contain', 'Login');
    cy.get('a[href="/login"]').click();
    cy.url().should('include', '/login');
  });

  it('should handle duplicate email registration', () => {
    cy.register(`Duplicate User ${Date.now()}`, `dup-${Date.now()}@example.com`, 'password123');
    cy.visit('/register');
    cy.register(`Duplicate User 2 ${Date.now()}`, `dup-${Date.now()}@example.com`, 'password123');
    cy.get('.error').should('exist');
  });
});
```

#### `cypress/e2e/06-user-management.cy.ts`

```typescript
describe('User Management', () => {
  beforeEach(() => {
    cy.login('alice@example.com', 'password123');
    cy.visit('/users');
  });

  it('should display user management page with user table', () => {
    cy.get('h1').should('contain', 'Manage Users');
    cy.get('.user-table').should('exist');
    cy.get('.user-table table').should('exist');
  });

  it('should create a new user with a specific role', () => {
    const timestamp = Date.now();
    cy.get('button').contains('Create User').click();
    cy.get('.modal input[placeholder="Name"]').type(`New User ${timestamp}`);
    cy.get('.modal input[placeholder="Email"]').type(`newuser-${timestamp}@example.com`);
    cy.get('.modal input[placeholder="Password"]').type('password123');
    cy.get('.modal select').select('member');
    cy.get('.modal button[type="submit"]').contains('Create').click();
    cy.get('.user-table').should('contain', `New User ${timestamp}`);
  });

  it('should toggle user active/inactive status', () => {
    cy.get('.user-table').contains('Deactivate').first().click();
    cy.get('.user-table').should('contain', 'Active');
  });

  it('should delete a user with confirmation', () => {
    cy.get('.user-table').contains('Delete').first().click();
    cy.get('.delete-confirm').should('exist');
    cy.get('.delete-confirm button').contains('Delete').click();
    // User should no longer appear in the table
  });

  it('should enforce role-based permissions (user role cannot access /users)', () => {
    cy.login('charlie@example.com', 'password123');
    cy.visit('/users');
    cy.url().should('include', '/dashboard');
  });

  it('should search users by name or email', () => {
    cy.get('.search-input').type('Alice');
    cy.get('.user-table').should('contain', 'Alice');
  });

  it('should filter users by role', () => {
    cy.get('.role-filter').select('member');
    cy.get('.user-table').should('exist');
  });
});
```

#### `cypress/e2e/07-ticket-assignment.cy.ts`

```typescript
describe('Ticket Assignment', () => {
  beforeEach(() => {
    cy.login('alice@example.com', 'password123');
    cy.visit('/projects');
    cy.get('.project-card').first().click();
    cy.url().should('include', '/tickets');
  });

  it('should assign a ticket to a user', () => {
    cy.get('.ticket-card').first().click();
    cy.url().should('include', '/tickets/');
    cy.get('button').contains('Edit Ticket').click();
    cy.get('.modal select').select('Bob Member');
    cy.get('.modal button[type="submit"]').contains('Save Changes').click();
    cy.get('.meta').should('contain', 'Bob Member');
  });

  it('should reassign a ticket to a different user', () => {
    // Assign to Bob
    cy.get('.ticket-card').first().click();
    cy.url().should('include', '/tickets/');
    cy.get('button').contains('Edit Ticket').click();
    cy.get('.modal select').select('Bob Member');
    cy.get('.modal button[type="submit"]').contains('Save Changes').click();
    cy.get('.meta').should('contain', 'Bob Member');

    // Reassign to Charlie
    cy.get('button').contains('Edit Ticket').click();
    cy.get('.modal select').select('Charlie User');
    cy.get('.modal button[type="submit"]').contains('Save Changes').click();
    cy.get('.meta').should('contain', 'Charlie User');
  });

  it('should show status transitions based on current status', () => {
    cy.get('.ticket-card').first().click();
    cy.url().should('include', '/tickets/');
    cy.get('.actions button').should('have.length.greaterThan', 0);
  });

  it('should show assignee name in ticket detail', () => {
    cy.get('.ticket-card').first().click();
    cy.url().should('include', '/tickets/');
    cy.get('.meta').should('exist');
  });

  it('full workflow: register → create user → assign ticket → change status', () => {
    // 1. Register a new user
    const timestamp = Date.now();
    cy.register(`Workflow User ${timestamp}`, `workflow-${timestamp}@example.com`, 'password123');

    // 2. Login as admin and create a project_admin user
    cy.login('alice@example.com', 'password123');
    cy.visit('/users');
    cy.get('button').contains('Create User').click();
    cy.get('.modal input[placeholder="Name"]').type(`Workflow Admin ${timestamp}`);
    cy.get('.modal input[placeholder="Email"]').type(`workflow-admin-${timestamp}@example.com`);
    cy.get('.modal input[placeholder="Password"]').type('password123');
    cy.get('.modal select').select('project_admin');
    cy.get('.modal button[type="submit"]').contains('Create').click();

    // 3. Navigate to project and assign ticket
    cy.visit('/projects');
    cy.get('.project-card').first().click();
    cy.url().should('include', '/tickets');
    cy.get('.ticket-card').first().click();
    cy.url().should('include', '/tickets/');
    cy.get('button').contains('Start Work').click();
    cy.get('.badge.status').should('contain', 'in_progress');
  });
});
```

### Data Flow Diagram

```
Developer runs: npm run cypress:e2e
    ↓
Cypress loads cypress/support/e2e.ts
    ↓
Import seed.ts → runs seed() in global before hook
    ↓
seed() calls POST /api/auth/register 3x (alice, bob, charlie)
seed() calls POST /api/auth/login 3x (gets tokens)
seed() calls POST /api/projects (creates 1 project)
seed() calls POST /api/tickets 2x (creates 2 tickets)
    ↓
Test 01-auth.cy.ts runs (uses seed data)
Test 02-projects.cy.ts runs (uses seed data)
Test 03-tickets.cy.ts runs (uses seed data)
Test 04-roles.cy.ts runs (uses seed data)
Test 05-registration.cy.ts runs (creates new accounts)
Test 06-user-management.cy.ts runs (creates/deletes users)
Test 07-ticket-assignment.cy.ts runs (assigns/reassigns tickets)
    ↓
All tests complete
```

### Alternative Designs Considered

- **Fixtures-based test data** — Chose API-based seeding because: fixtures are static JSON that don't interact with the live database, API seeding ensures test data actually exists in the DB, and it's more realistic (tests the full integration). Fixtures were considered but rejected because: they're only useful for `cy.fixture()`, not for creating actual DB records.

- **Database-level seeding (SQL scripts)** — Chose API-based seeding because: no new migration needed, works with any database backend, and tests the API layer too. SQL seeding was considered but rejected because: it requires a running database connection in Cypress, adds complexity, and doesn't test the API endpoints.

- **Separate seed command** — Chose global before hook because: simplest approach, no new npm script needed, and ensures every test run starts with clean data. Separate `npm run cypress:seed` was considered but rejected because: it requires manual coordination (seed first, then run tests), and developers might forget to seed.

- **Test isolation per spec file** — Chose shared seed because: all tests use the same project/tickets, reducing setup time and test count. Per-spec seeding was considered but rejected because: it would create duplicate projects/tickets, waste time, and increase flakiness.

---

## Dependencies

- **Existing**: All backend API endpoints exist and work
- **Existing**: Cypress is already installed and configured
- **Existing**: `cypress-localstorage-commands` package for localStorage access
- **New**: 3 new test files, 1 new seed file, 2 new custom commands
- **No new dependencies** — all packages already in `package.json`

---

## Risks/Edge Cases

- **[Seed failure]**: If seed fails to create users, all tests fail. Mitigation: add error handling in seed, log failures clearly.
- **[Race conditions]**: Multiple tests accessing the same project/tickets. Mitigation: use timestamp-based names, tests should be independent.
- **[Test order dependency]**: Tests running in different orders produce different results. Mitigation: each test should be self-contained, use seed data as base.
- **[Flaky tests]**: Cypress tests can be flaky due to timing. Mitigation: use `cy.get().should()` instead of `cy.wait()`, use `cy.intercept()` for API calls.
- **[Browser compatibility]**: Tests run in Chrome headless only. Mitigation: consistent viewport (1280x720), no browser-specific features.
- **[Token expiration]**: Auth tokens might expire during test run. Mitigation: seed creates fresh tokens, tests don't run for extended periods.

---

*Ready for implementation phase.*
