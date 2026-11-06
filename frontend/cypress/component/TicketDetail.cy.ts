import { createRouter, createMemoryHistory } from 'vue-router';
import TicketDetail from '@/views/TicketDetail.vue';
import { useAuthStore } from '@/stores/auth';

const Empty = { template: '<div />' };

const baseTicket = {
  id: '1',
  projectId: '1',
  title: 'Detail ticket',
  description: 'A description',
  status: 'backlog',
  priority: 'high',
  ownerId: '1',
  assigneeId: '2',
  assigneeName: 'Bob Member',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const planningUsage = {
  ticketId: 1,
  projectId: 1,
  projectName: 'Test project',
  totalCost: 0,
  totalTokensIn: 0,
  totalTokensOut: 0,
  totalDurationMs: 0,
  byStage: {},
  byFile: [],
};

function signIn() {
  const user = { id: '1', name: 'Admin', email: 'admin@test.com', role: 'project_admin' };
  const permissions = [
    'TICKET_UPDATE',
    'TICKET_DELETE',
    'TICKET_COMMENT',
    'TICKET_STATUS_CHANGE',
    'APPROVAL_APPROVE',
    'APPROVAL_REJECT',
  ];
  localStorage.clear();
  localStorage.setItem('vibecode_token', 'test-token');
  localStorage.setItem('vibecode_user', JSON.stringify(user));
  localStorage.setItem('vibecode_permissions', JSON.stringify(permissions));

  const store = useAuthStore();
  store.setToken('test-token');
  store.setUser(user);
  store.setPermissions(permissions);
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/projects/:id/tickets/:ticketId', name: 'TicketDetail', component: Empty },
      { path: '/projects/:id/tickets', name: 'ProjectTickets', component: Empty },
      { path: '/projects/:id/tickets/:ticketId/flow', name: 'PhaseFlow', component: Empty },
      { path: '/:pathMatch(.*)*', component: Empty },
    ],
  });
}

function mountDetail(router: ReturnType<typeof makeRouter>) {
  router.push('/projects/1/tickets/1');
  cy.wrap(router.isReady()).then(() => {
    cy.mount(TicketDetail, { global: { plugins: [router] } });
  });
}

describe('TicketDetail.vue', () => {
  afterEach(() => {
    useAuthStore().logout();
  });

  beforeEach(() => {
    signIn();
    // Fallback so no component request can reach the real API.
    cy.intercept({ method: 'GET', url: '/api/**' }, { statusCode: 200, body: { success: true, data: [] } });

    let ticketReads = 0;
    cy.intercept('GET', '/api/v1/tickets/1', (req) => {
      ticketReads += 1;
      req.reply({
        statusCode: 200,
        body: {
          success: true,
          data: ticketReads === 1
            ? baseTicket
            : { ...baseTicket, assigneeId: '3', assigneeName: 'Alice Admin' },
        },
      });
    }).as('ticket');

    cy.intercept('GET', '/api/v1/tickets/1/comments', { success: true, data: [] }).as('comments');
    cy.intercept('GET', '/api/v1/tickets/1/attachments', { success: true, data: [] }).as('attachments');
    cy.intercept('GET', '/api/v1/tickets/1/planning', { success: true, data: [] }).as('planning');
    cy.intercept('GET', '/api/v1/tickets/1/planning/usage', { success: true, data: planningUsage }).as('planningUsage');
    cy.intercept('GET', '/api/v1/approvals/ticket/1', { success: true, data: [] }).as('approvals');

    cy.intercept('GET', '/api/v1/projects/1/users', {
      statusCode: 200,
      body: {
        success: true,
        data: [
          { id: '2', name: 'Bob Member' },
          { id: '3', name: 'Alice Admin' },
        ],
      },
    }).as('projectUsers');

    cy.intercept('PUT', '/api/v1/tickets/1', {
      statusCode: 200,
      body: { success: true, data: { ...baseTicket, assigneeId: '3', assigneeName: 'Alice Admin' } },
    }).as('updateTicket');
  });

  it('renders the ticket header, status and description', () => {
    mountDetail(makeRouter());

    cy.wait(['@ticket', '@comments', '@approvals', '@attachments', '@planning', '@planningUsage']);
    cy.get('.ticket-header .title').should('contain', 'Detail ticket');
    cy.get('.badge.status').should('contain', 'backlog');
    cy.get('.description').should('contain', 'A description');
  });

  it('shows edit and delete actions for a project admin', () => {
    mountDetail(makeRouter());

    cy.wait(['@ticket', '@comments', '@approvals', '@attachments', '@planning', '@planningUsage']);
    cy.contains('button', 'Edit Ticket').should('exist');
    cy.contains('button', 'Delete Ticket').should('exist');
  });

  it('refreshes the assignee name after an edit save without a reload', () => {
    mountDetail(makeRouter());

    cy.wait(['@ticket', '@comments', '@approvals', '@attachments', '@planning', '@planningUsage']);
    cy.get('.meta').should('contain', 'Bob Member');

    cy.contains('button', 'Edit Ticket').click();
    cy.wait('@projectUsers');
    cy.get('.v-modal select').eq(1).select('Alice Admin');
    cy.contains('.v-modal button', 'Save Changes').click();

    cy.wait('@updateTicket');
    cy.wait('@ticket');
    cy.get('.meta').should('contain', 'Alice Admin');
    cy.get('.meta').should('not.contain', 'Bob Member');
  });
});
