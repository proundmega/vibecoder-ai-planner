describe('Project CRUD', () => {
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
    cy.visit('/projects');
  });

  it('should display the project list page', () => {
    cy.get('h1').should('contain', 'My Projects');
    cy.get('.project-card').should('have.length.greaterThan', 0);
  });

  it('should list the API-seeded project', () => {
    cy.contains('.project-card', projectName).should('exist');
  });

  it('should create a new project', () => {
    const name = `Cypress Project ${Date.now()}`;

    cy.contains('button', '+ New Project').click();
    cy.get('.modal input[placeholder="Enter project name"]').clear().type(name);
    cy.get('.modal textarea[placeholder="Optional description"]').type('Created by Cypress');
    cy.get('.modal .btn-submit').contains('Create').click();

    // handleCreate navigates straight to the new board.
    cy.url().should('include', '/tickets');
    cy.visit('/projects');
    cy.contains('.project-card', name).should('exist');
  });

  it('should navigate to the ticket board from a project card', () => {
    cy.contains('.project-card', projectName).find('.card-main').click();
    cy.url().should('include', `/projects/${projectId}/tickets`);
  });

  it('should delete a project created through the API', () => {
    const name = `Delete Me ${Date.now()}`;

    cy.createProject(name).then(() => {
      cy.visit('/projects');
      cy.contains('.project-card', name).find('.btn-delete').click();
      cy.get('.btn-delete-modal').click();
      cy.contains('.project-card', name).should('not.exist');
    });
  });
});
