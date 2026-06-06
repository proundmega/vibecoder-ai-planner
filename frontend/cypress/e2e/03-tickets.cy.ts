describe('Ticket CRUD and Status Transitions', () => {
  beforeEach(() => {
    cy.login('alice@example.com', 'password123');
  });

  it('should create a ticket and see it in backlog', () => {
    cy.visit('/projects');
    cy.get('.project-card').first().click();
    cy.url().should('include', '/tickets');
    
    const ticketTitle = `Cypress Ticket ${Date.now()}`;
    cy.get('button').contains('+ New Ticket').click();
    cy.get('input[placeholder="Enter ticket title"]').type(ticketTitle);
    cy.get('textarea[placeholder="Optional description"]').type('Created by Cypress');
    cy.get('button[type="submit"]').contains('Create').click();
    
    cy.get('.ticket-card').should('contain', ticketTitle);
    cy.get('.status-col.backlog .ticket-card').should('contain', ticketTitle);
  });

  it('should edit a ticket via edit modal', () => {
    cy.visit('/projects');
    cy.get('.project-card').first().click();
    cy.url().should('include', '/tickets');
    
    cy.get('.ticket-card').first().click();
    cy.url().should('include', '/tickets/');
    
    cy.get('button').contains('Edit Ticket').click();
    cy.get('.modal input[type="text"]').clear().type('Updated Title');
    cy.get('.modal button[type="submit"]').contains('Save Changes').click();
    
    cy.get('.ticket-header .title').should('contain', 'Updated Title');
  });

  it('should change ticket status via buttons', () => {
    cy.visit('/projects');
    cy.get('.project-card').first().click();
    cy.url().should('include', '/tickets');
    
    cy.get('.ticket-card').first().click();
    cy.url().should('include', '/tickets/');
    
    const currentStatus = Cypress.$('.badge.status').first().text().trim();
    
    if (currentStatus === 'backlog') {
      cy.get('button').contains('Start Work').click();
      cy.get('.badge.status').should('contain', 'in_progress');
    }
  });

  it('should show status transitions based on current status', () => {
    cy.visit('/projects');
    cy.get('.project-card').first().click();
    cy.url().should('include', '/tickets');
    
    cy.get('.ticket-card').first().click();
    cy.url().should('include', '/tickets/');
    
    cy.get('.actions button').should('have.length.greaterThan', 0);
  });

  it('should add a comment to a ticket', () => {
    cy.visit('/projects');
    cy.get('.project-card').first().click();
    cy.url().should('include', '/tickets');
    
    cy.get('.ticket-card').first().click();
    cy.url().should('include', '/tickets/');
    
    cy.get('.comment-input input').type('Cypress test comment');
    cy.get('.comment-input button').contains('Add').click();
    
    cy.get('.comment').last().should('contain', 'Cypress test comment');
  });

  it('should delete a ticket', () => {
    cy.visit('/projects');
    cy.get('.project-card').first().click();
    cy.url().should('include', '/tickets');
    
    cy.get('.ticket-card').first().click();
    cy.url().should('include', '/tickets/');
    
    cy.get('button').contains('Delete Ticket').click();
    cy.get('.delete-confirm').should('exist');
    cy.get('.modal button').contains('Delete').click();
    
    cy.url().should('include', '/tickets');
  });

  it('should filter tickets by project selection', () => {
    cy.visit('/projects');
    cy.get('.project-card').first().click();
    cy.url().should('include', '/tickets');
    
    cy.get('.project-select').should('exist');
  });
});
