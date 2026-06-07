import { mount } from 'cypress/vue';
import './commands';

Cypress.Commands.add('mount', (component, options = {}) => {
  return mount(component, options);
});
