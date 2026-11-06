describe('Authentication Flows', () => {
  let admin: any;

  before(() => {
    cy.seed().then((seed) => {
      admin = seed.users.admin;
    });
  });

  beforeEach(() => {
    cy.visit('/login');
  });

  it('should render login page with email and password fields', () => {
    cy.get('h1').should('contain', 'Sign In');
    cy.get('input[type="email"]').should('exist');
    cy.get('input[type="password"]').should('exist');
    cy.get('button[type="submit"]').should('exist');
  });

  it('should not submit an empty form', () => {
    cy.get('button[type="submit"]').click();
    cy.url().should('include', '/login');
    cy.get('input[type="email"]').should('have.value', '');
    cy.get('input[type="password"]').should('have.value', '');
  });

  it('should login with API-seeded credentials and redirect to dashboard', () => {
    cy.get('input[type="email"]').type(admin.email);
    cy.get('input[type="password"]').type(admin.password);
    cy.get('button[type="submit"]').click();

    cy.url().should('include', '/dashboard');
    cy.getLocalStorage('vibecode_token').should('exist');
    cy.getLocalStorage('vibecode_permissions').then((perms) => {
      expect(JSON.parse(perms || '[]')).to.include('DASHBOARD_READ');
    });
    cy.getLocalStorage('vibecode_user').then((userStr) => {
      expect(JSON.parse(userStr || '{}').email).to.equal(admin.email);
    });
  });

  it('should show an error on invalid credentials', () => {
    cy.get('input[type="email"]').type(`wrong-${Date.now()}@example.com`);
    cy.get('input[type="password"]').type('wrongpassword');
    cy.get('button[type="submit"]').click();

    cy.get('.login__error').should('be.visible');
    cy.url().should('include', '/login');
  });

  it('should redirect unauthenticated users from dashboard to login', () => {
    cy.clearLocalStorage();
    cy.visit('/dashboard');
    cy.url().should('include', '/login');
  });

  it('should navigate to register page from login', () => {
    cy.get('.login__link a[href="/register"]').should('contain', 'Register').click();
    cy.url().should('include', '/register');
  });

  it('should logout and redirect to login', () => {
    cy.login(admin.email, admin.password);
    cy.visit('/dashboard');
    cy.contains('button', 'Logout').click();
    cy.url().should('include', '/login');
    cy.getLocalStorage('vibecode_token').should('not.exist');
  });
});
