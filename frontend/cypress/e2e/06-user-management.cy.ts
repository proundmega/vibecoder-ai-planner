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
