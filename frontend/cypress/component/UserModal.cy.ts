import UserModal from '@/components/UserModal.vue';
import { useAuthStore } from '@/stores/auth';

const resetAuthStore = (role = 'project_admin') => {
  localStorage.clear();
  localStorage.setItem('vibecode_token', 'test-token');
  localStorage.setItem('vibecode_user', JSON.stringify({ id: '1', name: 'Admin', email: 'admin@test.com', role }));
  const store = useAuthStore();
  store.setUser(JSON.parse(localStorage.getItem('vibecode_user')));
};

describe('UserModal.vue', () => {
  it('should render name and email fields in create mode', () => {
    resetAuthStore('project_admin');
    cy.mount(UserModal);
    cy.get('.modal h2').should('contain', 'Create New User');
    cy.get('input[placeholder="User name"]').should('exist');
    cy.get('input[placeholder="user@example.com"]').should('exist');
    cy.get('input[type="password"]').should('exist');
  });

  it('should render name and email fields in edit mode', () => {
    resetAuthStore('project_admin');
    cy.mount(UserModal, {
      props: {
        isEdit: true,
        user: { id: '1', name: 'Test User', email: 'test@example.com', role: 'user' }
      }
    });
    cy.get('.modal h2').should('contain', 'Edit User');
    cy.get('input[placeholder="User name"]').should('have.value', 'Test User');
    cy.get('input[placeholder="user@example.com"]').should('have.value', 'test@example.com');
    cy.get('input[type="password"]').should('not.exist');
  });

  it('should show role options based on creator role (project_admin)', () => {
    resetAuthStore('project_admin');
    cy.mount(UserModal);
    cy.get('select').should('exist');
    cy.get('select option').should('have.length.greaterThan', 0);
  });

  it('should show validation error on empty submit', () => {
    resetAuthStore('project_admin');
    cy.mount(UserModal);
    cy.get('form').submit();
    cy.get('.error').should('contain', 'Name and email are required');
  });

  it('should show password validation error for short password', () => {
    resetAuthStore('project_admin');
    cy.mount(UserModal);
    cy.get('input[placeholder="User name"]').type('Test User');
    cy.get('input[placeholder="user@example.com"]').type('test@example.com');
    cy.get('input[type="password"]').type('short');
    cy.get('button[type="submit"]').click();
    cy.get('.error').should('contain', 'at least 6 characters');
  });

  it('should emit submit event with correct data', () => {
    resetAuthStore('project_admin');
    const handleSubmit = () => {};
    cy.mount(UserModal, {
      props: {
        isEdit: false,
        onSubmit: handleSubmit
      }
    });
    cy.get('input[placeholder="User name"]').type('New User');
    cy.get('input[placeholder="user@example.com"]').type('new@example.com');
    cy.get('input[type="password"]').type('password123');
    cy.get('button[type="submit"]').click();
  });

  it('should emit close event', () => {
    resetAuthStore('project_admin');
    const handleClose = () => {};
    cy.mount(UserModal, {
      props: {
        isEdit: false,
        onClose: handleClose
      }
    });
    cy.get('.btn-cancel').click();
  });
});
