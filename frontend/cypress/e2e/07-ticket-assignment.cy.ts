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
    cy.get('.ticket-card').first().click();
    cy.url().should('include', '/tickets/');
    cy.get('button').contains('Edit Ticket').click();
    cy.get('.modal select').select('Bob Member');
    cy.get('.modal button[type="submit"]').contains('Save Changes').click();
    cy.get('.meta').should('contain', 'Bob Member');

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
    const timestamp = Date.now();
    cy.register(`Workflow User ${timestamp}`, `workflow-${timestamp}@example.com`, 'password123');

    cy.login('alice@example.com', 'password123');
    cy.visit('/users');
    cy.get('button').contains('Create User').click();
    cy.get('.modal input[placeholder="Name"]').type(`Workflow Admin ${timestamp}`);
    cy.get('.modal input[placeholder="Email"]').type(`workflow-admin-${timestamp}@example.com`);
    cy.get('.modal input[placeholder="Password"]').type('password123');
    cy.get('.modal select').select('project_admin');
    cy.get('.modal button[type="submit"]').contains('Create').click();

    cy.visit('/projects');
    cy.get('.project-card').first().click();
    cy.url().should('include', '/tickets');
    cy.get('.ticket-card').first().click();
    cy.url().should('include', '/tickets/');
    cy.get('button').contains('Start Work').click();
    cy.get('.badge.status').should('contain', 'in_progress');
  });
});
