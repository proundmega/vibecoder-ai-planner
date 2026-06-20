describe('Registration Flow', () => {
  beforeEach(() => {
    cy.visit('/register');
  });

  it('should render registration page with name, email, and password fields', () => {
    cy.get('h1').should('contain', 'Create Account');
    cy.get('input[placeholder="Name"]').should('exist');
    cy.get('input[placeholder="Email"]').should('exist');
    cy.get('input[placeholder*="Password"]').should('exist');
    cy.get('button[type="submit"]').should('exist');
  });

  it('should register a new account and redirect to dashboard', () => {
    const timestamp = Date.now();
    cy.register(`Test User ${timestamp}`, `test-${timestamp}@example.com`, 'password123');
    cy.url().should('include', '/dashboard');
    cy.getLocalStorage('vibecode_token').should('exist');
    cy.getLocalStorage('vibecode_user').then((userStr) => {
      const user = JSON.parse(userStr || '{}');
      expect(user.email).to.include('test-');
    });
  });

  it('should show error on invalid registration (weak password)', () => {
    cy.get('input[placeholder="Name"]').type('Bad Password User');
    cy.get('input[placeholder="Email"]').type(`badpw-${Date.now()}@example.com`);
    cy.get('input[placeholder*="Password"]').type('short');
    cy.get('button[type="submit"]').click();
    cy.get('.error').should('exist');
  });

  it('should redirect to login from registration page', () => {
    cy.get('a[href="/login"]').should('contain', 'Login');
    cy.get('a[href="/login"]').click();
    cy.url().should('include', '/login');
  });

  it('should handle duplicate email registration', () => {
    const timestamp = Date.now();
    cy.register(`Duplicate User ${timestamp}`, `dup-${timestamp}@example.com`, 'password123');
    cy.visit('/register');
    const timestamp2 = Date.now();
    cy.register(`Duplicate User 2 ${timestamp2}`, `dup-${timestamp2}@example.com`, 'password123');
    cy.get('.error').should('exist');
  });
});
