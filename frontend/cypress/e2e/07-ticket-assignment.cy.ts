describe('Ticket Assignment', () => {
  let admin: any;
  let member: any;
  let projectId: string;

  before(() => {
    cy.seed().then((seed) => {
      admin = seed.users.admin;
      member = seed.users.member;
      projectId = seed.projectId;
    });
  });

  function openFreshTicket(title: string) {
    // Ticket writes are project-scoped (bp-133 FR4). The seeded member owns
    // the ticket created here, which keeps the ticket-owner path valid while
    // the project owner (admin) remains available in the assignee list.
    cy.login(member.email, member.password);
    cy.createTicket(projectId, title).then((ticketId) => {
      cy.visit(`/projects/${projectId}/tickets/${ticketId}`);
    });
  }

  it('should assign a ticket to the project owner from the edit modal', () => {
    openFreshTicket(`Assign Ticket ${Date.now()}`);

    cy.contains('button', 'Edit Ticket').click();
    cy.get('.v-modal select').eq(1).select(admin.name);
    cy.contains('.v-modal button', 'Save Changes').click();

    cy.get('.meta').should('contain', admin.name);
  });

  it('should clear an assignment back to unassigned', () => {
    openFreshTicket(`Reassign Ticket ${Date.now()}`);

    cy.contains('button', 'Edit Ticket').click();
    cy.get('.v-modal select').eq(1).select(admin.name);
    cy.contains('.v-modal button', 'Save Changes').click();
    cy.get('.meta').should('contain', admin.name);

    cy.contains('button', 'Edit Ticket').click();
    cy.get('.v-modal select').eq(1).select('Unassigned');
    cy.contains('.v-modal button', 'Save Changes').click();
    cy.get('.meta').should('not.contain', admin.name);
  });

  it('should show the status actions for an assigned ticket', () => {
    openFreshTicket(`Actions Ticket ${Date.now()}`);

    cy.get('.actions button').should('have.length.greaterThan', 0);
  });
});
