describe('Registration Flow', () => {
  let admin: any;

  before(() => {
    cy.seed().then((seed) => {
      admin = seed.users.admin;
    });
  });

  beforeEach(() => {
    cy.visit('/register');
  });

  it('should render registration fields', () => {
    cy.get('h1').should('contain', 'Create Account');
    cy.get('input[placeholder="Name"]').should('exist');
    cy.get('input[placeholder="Email"]').should('exist');
    cy.get('input[placeholder*="Password"]').should('exist');
    cy.get('button[type="submit"]').should('exist');
  });

  it('should register a new account and redirect to dashboard', () => {
    const timestamp = Date.now();

    cy.get('input[placeholder="Name"]').type(`Registered ${timestamp}`);
    cy.get('input[placeholder="Email"]').type(`registered-${timestamp}@example.com`);
    cy.get('input[placeholder*="Password"]').type('password123');
    cy.get('button[type="submit"]').click();

    cy.url().should('include', '/dashboard');
    cy.getLocalStorage('vibecode_token').should('exist');
    cy.getLocalStorage('vibecode_user').then((userStr) => {
      expect(JSON.parse(userStr || '{}').email).to.include(`registered-${timestamp}`);
    });
  });

  it('should show an error for a duplicate email', () => {
    cy.get('input[placeholder="Name"]').type('Duplicate Email');
    cy.get('input[placeholder="Email"]').type(admin.email);
    cy.get('input[placeholder*="Password"]').type('password123');
    cy.get('button[type="submit"]').click();

    cy.get('.register__error').should('be.visible');
    cy.url().should('include', '/register');
  });

  it('should navigate to login from the registration page', () => {
    cy.get('.register__link a[href="/login"]').should('contain', 'Login').click();
    cy.url().should('include', '/login');
  });
});
