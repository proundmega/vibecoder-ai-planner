describe('Project CRUD', () => {
  beforeEach(() => {
    cy.login('alice@example.com', 'password123');
    cy.visit('/projects');
  });

  it('should display project list page', () => {
    cy.get('h1').should('contain', 'Projects');
  });

  it('should create a new project', () => {
    const projectName = `Test Project ${Date.now()}`;
    cy.get('button').contains('Create Project').click();
    cy.get('input[placeholder="Project name"]').clear().type(projectName);
    cy.get('textarea[placeholder="Project description"]').type('Created by Cypress test');
    cy.get('button[type="submit"]').contains('Create').click();
    cy.url().should('include', '/projects');
    cy.get('.project-card').should('contain', projectName);
  });

  it('should list existing projects', () => {
    cy.get('.project-card').should('have.length.greaterThan', 0);
  });

  it('should navigate to project detail from project list', () => {
    cy.get('.project-card').first().click();
    cy.url().should('include', '/projects/');
    cy.url().should('include', '/tickets');
  });

  it('should delete a project', () => {
    cy.createProject(`Delete Me ${Date.now()}`).then((projectId) => {
      cy.visit('/projects');
      cy.get('.project-card').should('have.length.greaterThan', 0);
    });
  });
});
