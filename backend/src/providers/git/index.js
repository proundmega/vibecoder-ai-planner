const contract = require('./GitProvider');
const github = require('./github');

const registry = contract.createRegistry();
registry.register('github', github.createProvider);

module.exports = {
  ...contract,
  registry,
  github,
};
