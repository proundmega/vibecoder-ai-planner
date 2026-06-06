describe('Authentication Flows', () => {
  beforeEach(() => {
    cy.visit('/login');
  });

  it('should render login page with email and password fields', () => {
    cy.get('h1').should('contain', 'Sign In');
    cy.get('input[type="email"]').should('exist');
    cy.get('input[type="password"]').should('exist');
    cy.get('button[type="submit"]').should('exist');
  });

  it('should show error on empty form submit', () => {
    cy.get('button[type="submit"]').click();
    cy.get('input[type="email"]').should('have.value', '');
    cy.get('input[type="password"]').should('have.value', '');
  });

  it('should login with valid credentials and redirect to dashboard', () => {
    cy.login('alice@example.com', 'password123');
    cy.url().should('include', '/dashboard');
    cy.getLocalStorage('vibecode_token').should('exist');
    cy.getLocalStorage('vibecode_user').then((userStr) => {
      const user = JSON.parse(userStr || '{}');
      expect(user.email).to.equal('alice@example.com');
    });
  });

  it('should show error on invalid credentials', () => {
    cy.get('input[type="email"]').clear().type('wrong@example.com');
    cy.get('input[type="password"]').clear().type('wrongpassword');
    cy.get('button[type="submit"]').click();
    cy.get('.error').should('exist');
    cy.url().should('include', '/login');
  });

  it('should redirect unauthenticated users from dashboard to login', () => {
    cy.clearLocalStorage();
    cy.visit('/dashboard');
    cy.url().should('include', '/login');
  });

  it('should navigate to register page from login', () => {
    cy.get('a[href="/register"]').should('contain', 'Register');
    cy.get('a[href="/register"]').click();
    cy.url().should('include', '/register');
  });

  it('should logout and redirect to login', () => {
    cy.login('alice@example.com', 'password123');
    cy.url().should('include', '/dashboard');
    cy.clearLocalStorage();
    cy.visit('/dashboard');
    cy.url().should('include', '/login');
  });
});
