// Test data seeding for Cypress E2E tests
// Creates users, project, and tickets with timestamp-based names for isolation

const TIMESTAMP = Date.now();

interface SeedUser {
  name: string;
  email: string;
  password: string;
  role: string;
  id: string;
}

interface SeedResult {
  users: SeedUser[];
  projectId: string;
}

function seed(): Cypress.Chainable<SeedResult> {
  const registeredUsers: SeedUser[] = [];
  const tokens: Record<string, string> = {};

  const users = [
    { name: `Alice Admin ${TIMESTAMP}`, email: `alice-test-${TIMESTAMP}@example.com`, password: 'password123', role: 'project_admin' },
    { name: `Bob Member ${TIMESTAMP}`, email: `bob-test-${TIMESTAMP}@example.com`, password: 'password123', role: 'member' },
    { name: `Charlie User ${TIMESTAMP}`, email: `charlie-test-${TIMESTAMP}@example.com`, password: 'password123', role: 'user' },
  ];

  let projectId = '';

  // Register Alice
  cy.request({
    method: 'POST',
    url: '/api/auth/register',
    body: { name: users[0].name, email: users[0].email, password: users[0].password },
    failOnStatusCode: false,
  }).then((resp) => {
    if (resp.status === 201) {
      const userData = resp.body.user || resp.body.data?.user;
      if (userData) registeredUsers.push({ ...users[0], id: userData.id });
    }
  }).then(() => {
    // Register Bob
    return cy.request({
      method: 'POST',
      url: '/api/auth/register',
      body: { name: users[1].name, email: users[1].email, password: users[1].password },
      failOnStatusCode: false,
    });
  }).then((resp) => {
    if (resp.status === 201) {
      const userData = resp.body.user || resp.body.data?.user;
      if (userData) registeredUsers.push({ ...users[1], id: userData.id });
    }
  }).then(() => {
    // Register Charlie
    return cy.request({
      method: 'POST',
      url: '/api/auth/register',
      body: { name: users[2].name, email: users[2].email, password: users[2].password },
      failOnStatusCode: false,
    });
  }).then((resp) => {
    if (resp.status === 201) {
      const userData = resp.body.user || resp.body.data?.user;
      if (userData) registeredUsers.push({ ...users[2], id: userData.id });
    }
  }).then(() => {
    // Login Alice
    return cy.request({
      method: 'POST',
      url: '/api/auth/login',
      body: { email: registeredUsers[0].email, password: registeredUsers[0].password },
      failOnStatusCode: false,
    });
  }).then((resp) => {
    if (resp.status === 200) tokens[registeredUsers[0].email] = resp.body.token;
  }).then(() => {
    // Login Bob
    return cy.request({
      method: 'POST',
      url: '/api/auth/login',
      body: { email: registeredUsers[1].email, password: registeredUsers[1].password },
      failOnStatusCode: false,
    });
  }).then((resp) => {
    if (resp.status === 200) tokens[registeredUsers[1].email] = resp.body.token;
  }).then(() => {
    // Login Charlie
    return cy.request({
      method: 'POST',
      url: '/api/auth/login',
      body: { email: registeredUsers[2].email, password: registeredUsers[2].password },
      failOnStatusCode: false,
    });
  }).then((resp) => {
    if (resp.status === 200) tokens[registeredUsers[2].email] = resp.body.token;
  }).then(() => {
    // Create project with admin token
    const adminEmail = registeredUsers[0]?.email;
    if (adminEmail && tokens[adminEmail]) {
      return cy.request({
        method: 'POST',
        url: '/api/projects',
        body: { name: `Test Project ${TIMESTAMP}`, description: 'Created by Cypress seed' },
        headers: { Authorization: `Bearer ${tokens[adminEmail]}` },
        failOnStatusCode: false,
      });
    }
    return null;
  }).then((resp) => {
    if (resp && resp.status === 201) {
      projectId = resp.body.id || resp.body.data?.id || '';
    }
  }).then(() => {
    // Create ticket 1
    const adminEmail = registeredUsers[0]?.email;
    if (projectId && adminEmail && tokens[adminEmail]) {
      return cy.request({
        method: 'POST',
        url: '/api/tickets',
        body: { projectId, title: `Ticket 1 - Backlog ${TIMESTAMP}`, description: 'Test ticket', status: 'backlog' },
        headers: { Authorization: `Bearer ${tokens[adminEmail]}` },
        failOnStatusCode: false,
      });
    }
    return null;
  }).then(() => {
    // Create ticket 2
    const adminEmail = registeredUsers[0]?.email;
    if (projectId && adminEmail && tokens[adminEmail]) {
      return cy.request({
        method: 'POST',
        url: '/api/tickets',
        body: { projectId, title: `Ticket 2 - In Progress ${TIMESTAMP}`, description: 'Test ticket', status: 'in_progress' },
        headers: { Authorization: `Bearer ${tokens[adminEmail]}` },
        failOnStatusCode: false,
      });
    }
    return null;
  }).then(() => {
    return { users: registeredUsers, projectId } as SeedResult;
  });
}

export { seed };
