import TicketDetail from '@/views/TicketDetail.vue';

describe('TicketDetail.vue', () => {
  beforeEach(() => {
    cy.intercept('GET', '/api/tickets/*', {
      id: 't-1',
      title: 'Test Ticket',
      description: 'This is a test ticket description',
      status: 'backlog',
      priority: 'high',
      assignee_id: 'user-1',
      assignee_name: 'Test Assignee',
      owner_email: 'owner@test.com',
      owner_id: 'user-1'
    }).as('fetchTicket');

    cy.intercept('GET', '/api/tickets/*/comments', []).as('fetchComments');

    cy.intercept('GET', '/api/approvals/ticket/*/approval-status', {
      hasPending: false
    }).as('fetchApprovals');

    cy.intercept('POST', '/api/auth/login', {
      statusCode: 200,
      body: {
        token: 'test-token',
        user: { id: '1', name: 'Admin', email: 'admin@test.com', role: 'project_admin' }
      }
    }).as('login');
  });

  it('should render ticket title and description', () => {
    cy.mount(TicketDetail, {
      global: {
        mocks: {
          route: {
            params: { ticketId: 't-1', id: 'proj-1' }
          },
          routeName: 'TicketDetail'
        }
      }
    });
    cy.wait('@fetchTicket');
    cy.get('.ticket-header .title').should('contain', 'Test Ticket');
    cy.get('.description p').should('contain', 'This is a test ticket description');
  });

  it('should render status badge', () => {
    cy.mount(TicketDetail, {
      global: {
        mocks: {
          route: {
            params: { ticketId: 't-1', id: 'proj-1' }
          }
        }
      }
    });
    cy.wait('@fetchTicket');
    cy.get('.badge.status').should('contain', 'backlog');
  });

  it('should show status transition buttons based on current status', () => {
    cy.mount(TicketDetail, {
      global: {
        mocks: {
          route: {
            params: { ticketId: 't-1', id: 'proj-1' }
          }
        }
      }
    });
    cy.wait('@fetchTicket');
    cy.get('.actions button').should('have.length.greaterThan', 0);
    cy.get('.actions button').contains('Start Work').should('exist');
  });

  it('should show edit and delete buttons for admin', () => {
    cy.mount(TicketDetail, {
      global: {
        mocks: {
          route: {
            params: { ticketId: 't-1', id: 'proj-1' }
          }
        }
      }
    });
    cy.wait('@fetchTicket');
    cy.get('button').contains('Edit Ticket').should('exist');
    cy.get('button').contains('Delete Ticket').should('exist');
  });

  it('should show meta information', () => {
    cy.mount(TicketDetail, {
      global: {
        mocks: {
          route: {
            params: { ticketId: 't-1', id: 'proj-1' }
          }
        }
      }
    });
    cy.wait('@fetchTicket');
    cy.get('.meta').should('contain', 'Priority:');
    cy.get('.meta').should('contain', 'Assignee:');
    cy.get('.meta').should('contain', 'Created by:');
  });

  it('should show comments section', () => {
    cy.mount(TicketDetail, {
      global: {
        mocks: {
          route: {
            params: { ticketId: 't-1', id: 'proj-1' }
          }
        }
      }
    });
    cy.wait('@fetchTicket');
    cy.get('.comments').should('exist');
    cy.get('.comment-input').should('exist');
  });

  it('should show approval status when pending', () => {
    cy.intercept('GET', '/api/approvals/ticket/*/approval-status', {
      hasPending: true
    }).as('fetchPendingApprovals');

    cy.mount(TicketDetail, {
      global: {
        mocks: {
          route: {
            params: { ticketId: 't-1', id: 'proj-1' }
          }
        }
      }
    });
    cy.wait('@fetchTicket');
    cy.get('.approval-badge').should('exist');
  });
});
