import EditTicketModal from '@/components/TicketEditModal.vue';
import { useAuthStore } from '@/stores/auth';

const ticket = {
  id: '1',
  title: 'Existing title',
  description: 'Existing description',
  priority: 'high',
  assigneeId: '2',
  ownerId: '1',
};

function signIn() {
  const user = { id: '1', name: 'Admin', email: 'admin@test.com', role: 'project_admin' };
  localStorage.clear();
  localStorage.setItem('vibecode_token', 'test-token');
  localStorage.setItem('vibecode_user', JSON.stringify(user));
  localStorage.setItem('vibecode_permissions', JSON.stringify(['TICKET_UPDATE']));

  const store = useAuthStore();
  store.setToken('test-token');
  store.setUser(user);
  store.setPermissions(['TICKET_UPDATE']);
}

function mountModal() {
  return cy.mount(EditTicketModal, {
    props: { ticket, projectId: '1' },
    global: { stubs: { teleport: true } },
  });
}

describe('EditTicketModal.vue', () => {
  beforeEach(() => {
    signIn();
    cy.intercept('GET', '/api/v1/projects/1/users', {
      statusCode: 200,
      body: { success: true, data: [{ id: '2', name: 'Bob Member' }] },
    }).as('projectUsers');
    cy.intercept('PUT', '/api/v1/tickets/1', {
      statusCode: 200,
      body: { success: true, data: {} },
    }).as('updateTicket');
  });

  it('exposes the title/description limits and the extended priorities', () => {
    mountModal();

    cy.get('input[placeholder="Ticket title"]').should('have.attr', 'maxlength', '200');
    cy.get('textarea').should('have.attr', 'maxlength', '5000');
    cy.get('select').eq(0).find('option').should('contain.text', 'Critical');
    cy.get('select').eq(0).find('option').should('contain.text', 'Urgent');
  });

  it('saves the title, description and selected assignee', () => {
    mountModal();
    cy.wait('@projectUsers');

    cy.get('input[placeholder="Ticket title"]').invoke('val', 'Updated title').trigger('input');
    cy.get('textarea').invoke('val', 'Updated description').trigger('input');
    cy.get('select').eq(1).select('Bob Member');
    cy.contains('button', 'Save Changes').click();

    cy.wait('@updateTicket').its('request.body').should('deep.include', {
      title: 'Updated title',
      description: 'Updated description',
      assigneeId: '2',
    });
  });

  it('clears the assignee to null when Unassigned is selected', () => {
    mountModal();
    cy.wait('@projectUsers');

    cy.get('select').eq(1).select('Unassigned');
    cy.contains('button', 'Save Changes').click();

    cy.wait('@updateTicket').its('request.body.assigneeId').should('eq', null);
  });

  it('requires a title before saving', () => {
    mountModal();
    cy.wait('@projectUsers');

    cy.get('input[placeholder="Ticket title"]').clear();
    cy.get('form').submit();

    cy.get('.v-input__error').should('contain', 'Title is required');
    cy.get('@updateTicket.all').should('have.length', 0);
  });
});
