describe('Role-Based Access Control', () => {
  let admin: any;
  let member: any;
  let agent: any;
  let projectId: string;

  before(() => {
    cy.seed().then((seed) => {
      admin = seed.users.admin;
      member = seed.users.member;
      agent = seed.users.agent;
      projectId = seed.projectId;
    });
  });

  it('should allow project_admin to access /users', () => {
    cy.login(admin.email, admin.password);
    cy.visit('/users');
    cy.url().should('include', '/users');
    cy.get('h1').should('contain', 'Manage Users');
  });

  it('should allow member to access /users', () => {
    cy.login(member.email, member.password);
    cy.visit('/users');
    cy.url().should('include', '/users');
  });

  it('should redirect the agent role away from /users', () => {
    cy.login(agent.email, agent.password);
    cy.visit('/users');
    cy.url().should('include', '/dashboard');
  });

  it('should redirect project_admin from /super-admin/users', () => {
    cy.login(admin.email, admin.password);
    cy.visit('/super-admin/users');
    cy.url().should('not.include', '/super-admin/users');
  });

  describe('Ticket permissions', () => {
    beforeEach(() => {
      cy.login(admin.email, admin.password);
    });

    it('should show edit and delete buttons for project_admin', () => {
      cy.createTicket(projectId, `RBAC Ticket ${Date.now()}`).then((ticketId) => {
        cy.visit(`/projects/${projectId}/tickets/${ticketId}`);
        cy.contains('button', 'Edit Ticket').should('exist');
        cy.contains('button', 'Delete Ticket').should('exist');
      });
    });
  });

  describe('Navigation visibility', () => {
    it('should show dashboard and projects links for all roles', () => {
      cy.login(admin.email, admin.password);
      cy.visit('/dashboard');
      cy.get('nav a').contains('Dashboard').should('exist');
      cy.get('nav a').contains('Projects').should('exist');
    });
  });
});
