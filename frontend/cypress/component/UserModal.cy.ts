import UserModal from '@/components/UserModal.vue';

describe('UserModal.vue', () => {
  it('should render name and email fields in create mode', () => {
    cy.mount(UserModal, {
      global: {
        mocks: {
          useAuthStore: {
            user: { value: { role: 'project_admin' } }
          }
        }
      }
    });
    cy.get('.modal h2').should('contain', 'Create New User');
    cy.get('input[placeholder="User name"]').should('exist');
    cy.get('input[placeholder="user@example.com"]').should('exist');
    cy.get('input[type="password"]').should('exist');
  });

  it('should render name and email fields in edit mode', () => {
    cy.mount(UserModal, {
      props: {
        isEdit: true,
        user: { id: '1', name: 'Test User', email: 'test@example.com', role: 'user' }
      },
      global: {
        mocks: {
          useAuthStore: {
            user: { value: { role: 'project_admin' } }
          }
        }
      }
    });
    cy.get('.modal h2').should('contain', 'Edit User');
    cy.get('input[placeholder="User name"]').should('have.value', 'Test User');
    cy.get('input[placeholder="user@example.com"]').should('have.value', 'test@example.com');
    cy.get('input[type="password"]').should('not.exist');
  });

  it('should show role options based on creator role (project_admin)', () => {
    cy.mount(UserModal, {
      global: {
        mocks: {
          useAuthStore: {
            user: { value: { role: 'project_admin' } }
          }
        }
      }
    });
    cy.get('select').should('exist');
    cy.get('select option').should('have.length.greaterThan', 0);
  });

  it('should show validation error on empty submit', () => {
    cy.mount(UserModal, {
      global: {
        mocks: {
          useAuthStore: {
            user: { value: { role: 'project_admin' } }
          }
        }
      }
    });
    cy.get('button[type="submit"]').click();
    cy.get('.error').should('contain', 'Name and email are required');
  });

  it('should show password validation error for short password', () => {
    cy.mount(UserModal, {
      global: {
        mocks: {
          useAuthStore: {
            user: { value: { role: 'project_admin' } }
          }
        }
      }
    });
    cy.get('input[placeholder="User name"]').type('Test User');
    cy.get('input[placeholder="user@example.com"]').type('test@example.com');
    cy.get('input[type="password"]').type('short');
    cy.get('button[type="submit"]').click();
    cy.get('.error').should('contain', 'at least 6 characters');
  });

  it('should emit submit event with correct data', () => {
    const handleSubmit = cy.fn().as('handleSubmit');
    cy.mount(UserModal, {
      props: {
        isEdit: false,
        onSubmit: handleSubmit
      },
      global: {
        mocks: {
          useAuthStore: {
            user: { value: { role: 'project_admin' } }
          }
        }
      }
    });
    cy.get('input[placeholder="User name"]').type('New User');
    cy.get('input[placeholder="user@example.com"]').type('new@example.com');
    cy.get('input[type="password"]').type('password123');
    cy.get('button[type="submit"]').click();
    cy.get('@handleSubmit').should('be.called');
  });

  it('should emit close event', () => {
    const handleClose = cy.fn().as('handleClose');
    cy.mount(UserModal, {
      props: {
        isEdit: false,
        onClose: handleClose
      },
      global: {
        mocks: {
          useAuthStore: {
            user: { value: { role: 'project_admin' } }
          }
        }
      }
    });
    cy.get('.btn-cancel').click();
    cy.get('@handleClose').should('be.called');
  });
});
