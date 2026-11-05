import './commands';

// UserManagement.delete uses window.confirm; auto-accept it.
Cypress.on('window:confirm', () => true);

Cypress.on('uncaught:exception', (err, runnable) => {
  if (err.message.includes('NavigationDuplicated') ||
      err.message.includes('Avoided redundant navigation') ||
      err.message.includes('max navigation')) {
    return false;
  }
  return true;
});
