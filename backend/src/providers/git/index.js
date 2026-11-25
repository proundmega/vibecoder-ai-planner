const contract = require('./GitProvider');
const github = require('./github');
const local = require('./local');

const registry = contract.createRegistry();
registry.register('github', github.createProvider);
registry.register('local', local.createProvider);

module.exports = {
  ...contract,
  registry,
  github,
  local,
};
