import TicketQuestionCard from '@/components/TicketQuestionCard.vue';

const question = {
  id: 7,
  run_id: '11111111-1111-4111-8111-111111111111',
  ticket_id: 1,
  project_id: 1,
  runtime_id: 3,
  kind: 'question',
  status: 'pending',
  prompt: 'Which helper should I use?',
};

describe('TicketQuestionCard (fg-55)', () => {
  beforeEach(() => {
    localStorage.setItem('vibecode_token', 'test-token');
  });

  it('renders a pending question and submits an answer', () => {
    cy.intercept('GET', '/api/v1/harness/tickets/1/questions*', {
      success: true,
      data: [question],
    }).as('question');
    cy.intercept('POST', '/api/v1/harness/runs/*/questions/7/answer', {
      success: true,
      data: { id: 7, status: 'answered' },
    }).as('answer');

    cy.mount(TicketQuestionCard, { props: { ticketId: 1 } });
    cy.wait('@question');
    cy.get('[data-testid="ticket-question-card"]').should('contain', 'Which helper should I use?');

    cy.get('textarea').type('Use the existing helper.');
    cy.get('button[type="submit"]').click();
    cy.wait('@answer').its('request.body').should('deep.equal', {
      answer: 'Use the existing helper.',
    });
    cy.get('[data-testid="ticket-question-card"]').should('not.exist');
  });

  it('renders nothing when there is no pending question', () => {
    cy.intercept('GET', '/api/v1/harness/tickets/1/questions*', {
      success: true,
      data: [],
    }).as('question');

    cy.mount(TicketQuestionCard, { props: { ticketId: 1 } });
    cy.wait('@question');
    cy.get('[data-testid="ticket-question-card"]').should('not.exist');
  });
});
