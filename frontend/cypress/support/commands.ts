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
    } else {
      throw new Error(`Login failed for ${email}: ${resp.body.error || 'Unknown error'}`);
    }
  });
});

Cypress.Commands.add('loginAsAdmin', () => {
  cy.login('alice@example.com', 'password123');
});

Cypress.Commands.add('logout', () => {
  cy.clearLocalStorage();
});

// CRUD commands
Cypress.Commands.add('createProject', (name: string, description = 'Test project') => {
  return cy.request({
    method: 'POST',
    url: '/api/projects',
    body: { name, description },
    failOnStatusCode: false,
  }).then((resp) => {
    if (resp.status === 201) return resp.body.id;
    throw new Error(`Failed to create project: ${resp.body.error || 'Unknown error'}`);
  });
});

Cypress.Commands.add('createTicket', (projectId: string, title: string, description = 'Test ticket') => {
  return cy.request({
    method: 'POST',
    url: '/api/tickets',
    body: { projectId, title, description },
    failOnStatusCode: false,
  }).then((resp) => {
    if (resp.status === 201) return resp.body.id;
    throw new Error(`Failed to create ticket: ${resp.body.error || 'Unknown error'}`);
  });
});

// Custom assertions
Cypress.Commands.add('assertStatusBadge', (status: string) => {
  cy.get('[data-testid="status-badge"]').should('contain', status);
});

Cypress.Commands.add('assertRoleBadge', (role: string) => {
  cy.get('[data-testid="role-badge"]').should('contain', role);
});
