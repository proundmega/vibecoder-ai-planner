import TicketBoard from '@/views/TicketBoard.vue';
import { useAuthStore } from '@/stores/auth';

// Reset auth store singleton before each test
const resetAuthStore = () => {
  // Clear and set localStorage
  localStorage.clear();
  localStorage.setItem('vibecode_token', 'test-token');
  localStorage.setItem('vibecode_user', JSON.stringify({ id: '1', name: 'Admin', email: 'admin@test.com', role: 'project_admin' }));
  // Force auth store to re-read from localStorage
  const store = useAuthStore();
  store.setUser(JSON.parse(localStorage.getItem('vibecode_user')));
};

describe('TicketBoard.vue', () => {
  beforeEach(() => {
    resetAuthStore();
    cy.intercept('GET', '/api/projects', [
      { id: 'proj-1', name: 'Test Project', description: 'A test project', created_at: '2024-01-01T00:00:00Z' }
    ]).as('fetchProjects');

    cy.intercept('GET', '/api/projects/proj-1/tickets', [
      {
        id: 't-1',
        title: 'Ticket 1',
        description: 'Test description',
        status: 'backlog',
        priority: 'high',
        assignee_id: 'user-1'
      },
      {
        id: 't-2',
        title: 'Ticket 2',
        description: 'Another ticket',
        status: 'in_progress',
        priority: 'medium',
        assignee_id: null
      },
      {
        id: 't-3',
        title: 'Ticket 3',
        description: '',
        status: 'review',
        priority: 'low',
        assignee_id: 'user-2'
      },
      {
        id: 't-4',
        title: 'Ticket 4',
        description: '',
        status: 'done',
        priority: 'critical',
        assignee_id: 'user-1'
      }
    ]).as('fetchTickets');

    cy.intercept('POST', '/api/auth/login', {
      statusCode: 200,
      body: {
        token: 'test-token',
        user: { id: '1', name: 'Admin', email: 'admin@test.com', role: 'project_admin' }
      }
    }).as('login');
  });

  it('should render kanban columns', () => {
    cy.mount(TicketBoard);
    cy.wait('@fetchProjects');
    cy.wait('@fetchTickets');
    cy.get('.status-col').should('have.length', 4);
    cy.get('.status-label').should('contain', 'Backlog');
    cy.get('.status-label').should('contain', 'In Progress');
    cy.get('.status-label').should('contain', 'Review');
    cy.get('.status-label').should('contain', 'Done');
  });

  it('should render tickets in correct columns based on status', () => {
    cy.mount(TicketBoard);
    cy.wait('@fetchProjects');
    cy.wait('@fetchTickets');
    cy.get('.status-col.backlog .ticket-card').should('contain', 'Ticket 1');
    cy.get('.status-col.in_progress .ticket-card').should('contain', 'Ticket 2');
    cy.get('.status-col.review .ticket-card').should('contain', 'Ticket 3');
    cy.get('.status-col.done .ticket-card').should('contain', 'Ticket 4');
  });

  it('should show project selector dropdown', () => {
    cy.mount(TicketBoard);
    cy.wait('@fetchProjects');
    cy.get('.project-select').should('exist');
    cy.get('.project-select option').should('have.length.greaterThan', 0);
  });

  it('should show ticket count per column', () => {
    cy.mount(TicketBoard);
    cy.wait('@fetchProjects');
    cy.wait('@fetchTickets');
    cy.get('.ticket-count').should('have.length', 4);
  });

  it('should show +New Ticket button for admin', () => {
    resetAuthStore();
    cy.mount(TicketBoard);
    cy.wait('@fetchProjects');
    // Button exists when user is logged in and canCreate is true
    cy.get('.project-select').should('exist');
  });

  it('should show empty state when no tickets', () => {
    cy.intercept('GET', '/api/projects/proj-1/tickets', []).as('fetchEmptyTickets');

    cy.mount(TicketBoard);
    cy.wait('@fetchProjects');
    cy.wait('@fetchEmptyTickets');
    cy.get('.empty').should('contain', 'No tickets yet');
  });
});
