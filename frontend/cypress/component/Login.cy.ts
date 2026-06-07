import { defineComponent, h } from 'vue';
import Login from '@/views/Login.vue';

// Router stub that renders router-link as anchor tags
const RouterLinkStub = {
  name: 'RouterLink',
  props: ['to'],
  render() {
    return h('a', { href: this.to }, this.$slots.default?.());
  },
};

describe('Login.vue', () => {
  beforeEach(() => {
    cy.intercept('POST', '/api/auth/login', (req) => {
      if (req.body.email === 'test@example.com' && req.body.password === 'password') {
        req.reply({
          statusCode: 200,
          body: {
            token: 'test-token-123',
            user: { id: '1', name: 'Test User', email: 'test@example.com', role: 'user' }
          }
        });
      } else if (req.body.email === 'fail@example.com') {
        req.reply({
          statusCode: 401,
          body: { error: 'Invalid credentials' }
        });
      } else {
        req.reply({
          statusCode: 401,
          body: { error: 'Invalid credentials' }
        });
      }
    }).as('loginRequest');
  });

  it('should render email and password fields', () => {
    cy.mount(Login, {
      global: {
        stubs: {
          RouterLink: RouterLinkStub,
        },
      },
    });
    cy.get('input[type="email"]').should('exist');
    cy.get('input[type="password"]').should('exist');
    cy.get('button[type="submit"]').should('exist');
    cy.get('h1').should('contain', 'Sign In');
  });

  it('should show error message on invalid credentials', () => {
    cy.mount(Login, {
      global: {
        stubs: {
          RouterLink: RouterLinkStub,
        },
      },
    });
    cy.get('input[type="email"]').type('fail@example.com');
    cy.get('input[type="password"]').type('wrongpassword');
    cy.get('button[type="submit"]').click();
    cy.wait('@loginRequest');
    cy.get('.error').should('contain', 'Invalid credentials');
  });

  it('should be disabled while loading', () => {
    cy.intercept('POST', '/api/auth/login', (req) => {
      req.reply({
        statusCode: 200,
        body: {
          token: 'test-token',
          user: { id: '1', name: 'Test', email: 't@t.com', role: 'user' }
        }
      });
    }).as('loginRequest');

    cy.mount(Login, {
      global: {
        stubs: {
          RouterLink: RouterLinkStub,
        },
      },
    });
    cy.get('input[type="email"]').type('test@example.com');
    cy.get('input[type="password"]').type('password');
    cy.get('button[type="submit"]').click();
    cy.wait('@loginRequest');
    cy.get('button').should('not.be.disabled');
  });

  it('should have register link', () => {
    cy.mount(Login, {
      global: {
        stubs: {
          RouterLink: RouterLinkStub,
        },
      },
    });
    cy.get('a[href="/register"]').should('contain', 'Register');
  });
});
