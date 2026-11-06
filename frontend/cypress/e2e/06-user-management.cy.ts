describe('User Management', () => {
  let admin: any;
  let member: any;

  before(() => {
    cy.seed().then((seed) => {
      admin = seed.users.admin;
      member = seed.users.member;
    });
  });

  beforeEach(() => {
    cy.login(admin.email, admin.password);
    cy.visit('/users');
  });

  it('should display the user table', () => {
    cy.get('h1').should('contain', 'Manage Users');
    cy.get('.user-table table').should('exist');
    cy.get('.user-table').should('contain', member.email);
  });

  it('should create a new user with a specific role', () => {
    const timestamp = Date.now();
    const name = `Created User ${timestamp}`;

    cy.contains('button', 'Create User').click();
    cy.get('.v-modal input[placeholder="User name"]').type(name);
    cy.get('.v-modal input[placeholder="user@example.com"]').type(`created-${timestamp}@example.com`);
    cy.get('.v-modal input[placeholder="Min 6 characters"]').type('password123');
    cy.get('.v-modal select').select('member');
    cy.contains('.v-modal button', 'Create').click();

    cy.get('.user-table').should('contain', name);
  });

  it('should toggle a user active status', () => {
    cy.contains('.user-table tr', member.email).find('.btn-deactivate').click();
    cy.contains('.user-table tr', member.email).should('contain', 'Deactivated');
  });

  it('should delete a user after confirmation', () => {
    const timestamp = Date.now();
    const email = `delete-${timestamp}@example.com`;

    cy.createUser(`Delete User ${timestamp}`, email).then(() => {
      cy.visit('/users');
      cy.contains('.user-table tr', email).find('.btn-delete').click();
      cy.get('.delete-confirm .btn-danger').click();
      cy.get('.delete-confirm').should('not.exist');

      // users are soft-deleted, so prove the account can no longer log in
      cy.request({
        method: 'POST',
        url: '/api/auth/login',
        body: { email, password: 'password123' },
        failOnStatusCode: false,
      }).then((resp) => {
        expect(resp.status).to.eq(401);
      });
    });
  });

  it('should search users by name or email', () => {
    cy.get('.search-input').type(admin.email);
    cy.get('.user-table').should('contain', admin.email);
  });

  it('should filter users by role', () => {
    cy.get('.role-filter').select('member');
    cy.get('.user-table').should('contain', member.email);
  });
});
