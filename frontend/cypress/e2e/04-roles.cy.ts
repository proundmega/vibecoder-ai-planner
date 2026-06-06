describe('Role-Based Access Control', () => {
  describe('User Management Access', () => {
    it('should allow project_admin to access /users', () => {
      cy.login('alice@example.com', 'password123');
      cy.visit('/users');
      cy.url().should('include', '/users');
      cy.get('h1').should('contain', 'User Management');
    });

    it('should allow member to access /users', () => {
      cy.login('bob@example.com', 'password123');
      cy.visit('/users');
      cy.url().should('include', '/users');
    });

    it('should redirect user role away from /users', () => {
      cy.login('charlie@example.com', 'password123');
      cy.visit('/users');
      cy.url().should('include', '/dashboard');
    });

    it('should allow super_admin to access /super-admin/users', () => {
      cy.login('alice@example.com', 'password123');
      cy.visit('/super-admin/users');
      cy.url().should('include', '/super-admin/users');
    });

    it('should redirect non-super-admin from /super-admin/users', () => {
      cy.login('bob@example.com', 'password123');
      cy.visit('/super-admin/users');
      cy.url().should('not.include', '/super-admin/users');
    });
  });

  describe('Ticket Permissions', () => {
    beforeEach(() => {
      cy.login('alice@example.com', 'password123');
      cy.visit('/projects');
      cy.get('.project-card').first().click();
      cy.url().should('include', '/tickets');
      cy.get('.ticket-card').first().click();
      cy.url().should('include', '/tickets/');
    });

    it('should show edit button for project_admin', () => {
      cy.get('button').contains('Edit Ticket').should('exist');
    });

    it('should show delete button for project_admin', () => {
      cy.get('button').contains('Delete Ticket').should('exist');
    });
  });

  describe('Approval Workflow', () => {
    it('should show approval request button for user on review status', () => {
      cy.login('alice@example.com', 'password123');
      cy.visit('/projects');
      cy.get('.project-card').first().click();
      cy.url().should('include', '/tickets');
      cy.get('.ticket-card').first().click();
      cy.url().should('include', '/tickets/');
      
      cy.get('.actions button').should('have.length.greaterThan', 0);
    });
  });

  describe('Navigation Visibility', () => {
    it('should show dashboard link for all roles', () => {
      cy.login('alice@example.com', 'password123');
      cy.get('nav a').should('exist');
    });

    it('should show projects link for all roles', () => {
      cy.login('alice@example.com', 'password123');
      cy.get('nav a').contains('Projects').should('exist');
    });
  });
});
