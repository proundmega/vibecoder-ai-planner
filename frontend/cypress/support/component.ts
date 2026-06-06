import { mount } from 'cypress/vue';
import './commands';
import '../fixtures/users.json';
import '../fixtures/projects.json';
import '../fixtures/tickets.json';

Cypress.Commands.add('mount', (component, options = {}) => {
  return mount(component, options);
});
