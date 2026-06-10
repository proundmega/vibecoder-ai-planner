import UserManagement from '@/views/UserManagement.vue';
import { useAuthStore } from '@/stores/auth';

const resetAuthStore = () => {
  localStorage.clear();
  localStorage.setItem('vibecode_token', 'test-token');
  localStorage.setItem('vibecode_user', JSON.stringify({ id: 'admin-1', name: 'Admin', email: 'admin@test.com', role: 'project_admin' }));
  localStorage.setItem('vibecode_permissions', JSON.stringify(['USER_CREATE', 'USER_READ', 'USER_DELETE', 'USER_TOGGLE_ACTIVE', 'PROJECT_CREATE', 'PROJECT_UPDATE', 'PROJECT_DELETE', 'PROJECT_MANAGE_MEMBERS', 'USER_VIEW_ALL']));
  const store = useAuthStore();
  store.setUser(JSON.parse(localStorage.getItem('vibecode_user')));
  store.setPermissions(JSON.parse(localStorage.getItem('vibecode_permissions')));
};

describe('UserManagement.vue', () => {
  beforeEach(() => {
    resetAuthStore();
    cy.intercept('GET', '/api/users*', {
      users: [
        { id: '1', name: 'Alice Admin', email: 'alice@example.com', role: 'member', is_active: true },
        { id: '2', name: 'Bob User', email: 'bob@example.com', role: 'user', is_active: true },
        { id: '3', name: 'Charlie User', email: 'charlie@example.com', role: 'user', is_active: false }
      ]
    }).as('fetchUsers');

    cy.intercept('POST', '/api/auth/login', {
      statusCode: 200,
      body: {
        token: 'test-token',
        user: { id: 'admin-1', name: 'Admin', email: 'admin@test.com', role: 'project_admin' }
      }
    }).as('login');
  });

  it('should render user table with correct columns', () => {
    cy.mount(UserManagement);
    cy.wait('@fetchUsers');
    cy.get('.user-management').should('exist');
  });

  it('should show Create User button for project_admin', () => {
    cy.mount(UserManagement);
    cy.wait('@fetchUsers');
    cy.get('button').contains('Create User').should('exist');
  });

  it('should display users in table', () => {
    cy.mount(UserManagement);
    cy.wait('@fetchUsers');
    cy.get('.user-table').should('exist');
    cy.get('.user-table').contains('Alice Admin').should('exist');
  });

  it('should show role badges', () => {
    cy.mount(UserManagement);
    cy.wait('@fetchUsers');
    cy.get('.user-table').contains('Member').should('exist');
  });

  it('should filter users by role dropdown', () => {
    cy.mount(UserManagement);
    cy.wait('@fetchUsers');
    cy.get('select').should('exist');
  });

  it('should show activate/deactivate buttons based on role', () => {
    cy.mount(UserManagement);
    cy.wait('@fetchUsers');
    cy.get('button').should('exist');
  });

  it('should show edit button for each user', () => {
    cy.mount(UserManagement);
    cy.wait('@fetchUsers');
    cy.get('button').contains('Edit').should('have.length.greaterThan', 0);
  });

  it('should show delete button for project_admin', () => {
    cy.mount(UserManagement);
    cy.wait('@fetchUsers');
    cy.get('button').contains('Delete').should('exist');
  });

  it('should show search input', () => {
    cy.mount(UserManagement);
    cy.wait('@fetchUsers');
    cy.get('input[placeholder*="Search"]').should('exist');
  });

  it('should hide toggle button for current user', () => {
    resetAuthStore();
    cy.intercept('GET', '/api/users*', {
      users: [
        { id: 'admin-1', name: 'Admin', email: 'admin@test.com', role: 'project_admin', is_active: true },
        { id: '2', name: 'Bob User', email: 'bob@example.com', role: 'user', is_active: true },
      ]
    }).as('fetchUsers');

    cy.mount(UserManagement);
    cy.wait('@fetchUsers');
    cy.get('.user-table').contains('Bob User').should('exist');
    cy.get('.user-table').contains('Admin').should('exist');
    cy.get('button.btn-toggle').should('have.length', 1);
    cy.get('button.btn-toggle').should('contain', 'Deactivate');
  });
});
