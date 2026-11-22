describe('Ticket CRUD and Status Transitions', () => {
  let admin: any;
  let projectId: string;
  let projectName: string;

  before(() => {
    cy.seed().then((seed) => {
      admin = seed.users.admin;
      projectId = seed.projectId;
      projectName = seed.projectName;
    });
  });

  beforeEach(() => {
    cy.login(admin.email, admin.password);
  });

  it('should create a ticket and open it in the Edit Ticket view', () => {
    const title = `Board Ticket ${Date.now()}`;

    cy.visit(`/projects/${projectId}/tickets`);
    cy.contains('button', '+ New Ticket').click();
    cy.get('.modal input[placeholder="Enter ticket title"]').type(title);
    // The readiness wizard replaced the old description placeholder; target the
    // description field positionally so copy changes do not break the spec.
    cy.get('.modal textarea').first().type('Created by Cypress');
    cy.get('.modal .btn-submit').contains('Create').click();

    // Creating now navigates straight into the ticket's edit view.
    cy.url().should('match', new RegExp(`/projects/${projectId}/tickets/\\d+\\?edit=1$`));
    cy.get('.v-modal').should('be.visible').and('contain', 'Edit Ticket');

    // The ticket persisted: close the modal and it is on the backlog board.
    cy.contains('.v-modal button', 'Cancel').click();
    cy.visit(`/projects/${projectId}/tickets`);
    cy.get('.status-col.backlog .ticket-card').should('contain', title);
  });

  it('should edit a ticket through the edit modal', () => {
    const title = `Editable Ticket ${Date.now()}`;
    const updated = `Updated ${Date.now()}`;

    cy.createTicket(projectId, title).then((ticketId) => {
      cy.visit(`/projects/${projectId}/tickets/${ticketId}`);
      cy.contains('button', 'Edit Ticket').click();
      cy.get('.v-modal input[placeholder="Ticket title"]').clear().type(updated);
      cy.contains('.v-modal button', 'Save Changes').click();

      cy.get('.ticket-header .title').should('contain', updated);
    });
  });

  it('should move a backlog ticket to in progress', () => {
    const title = `Transition Ticket ${Date.now()}`;

    cy.createTicket(projectId, title).then((ticketId) => {
      cy.visit(`/projects/${projectId}/tickets/${ticketId}`);
      cy.contains('button', 'Start Work').click();
      cy.get('.badge.status').should('contain', 'in_progress');
    });
  });

  it('should add a comment to a ticket', () => {
    const title = `Comment Ticket ${Date.now()}`;
    const comment = `Cypress comment ${Date.now()}`;

    cy.createTicket(projectId, title).then((ticketId) => {
      cy.visit(`/projects/${projectId}/tickets/${ticketId}`);
      cy.get('.comment-input input').type(comment);
      cy.contains('.comment-input button', 'Add').click();
      cy.get('.comment').should('contain', comment);
    });
  });

  it('should delete a ticket after confirmation', () => {
    const title = `Delete Ticket ${Date.now()}`;

    cy.createTicket(projectId, title).then((ticketId) => {
      cy.visit(`/projects/${projectId}/tickets/${ticketId}`);
      cy.contains('button', 'Delete Ticket').click();
      cy.get('.delete-confirm .btn-danger').click();
      cy.url().should('include', `/projects/${projectId}/tickets`);
      cy.url().should('not.include', `/tickets/${ticketId}`);
    });
  });

  it('should show the project selector on the board', () => {
    cy.visit(`/projects/${projectId}/tickets`);
    cy.get('.project-select').should('contain', projectName);
  });
});
