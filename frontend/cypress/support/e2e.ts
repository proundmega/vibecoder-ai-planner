import './commands';

Cypress.on('uncaught:exception', (err, runnable) => {
  if (err.message.includes('NavigationDuplicated') ||
      err.message.includes('Avoided redundant navigation') ||
      err.message.includes('max navigation')) {
    return false;
  }
  return true;
});
