const contract = require('./GitProvider');
const github = require('./github');
const local = require('./local');
const forgejo = require('./forgejo');

const registry = contract.createRegistry();
registry.register('github', github.createProvider);
registry.register('local', local.createProvider);
registry.register('forgejo', config => forgejo.createProvider(config, 'forgejo'));
registry.register('gitea', config => forgejo.createProvider(config, 'gitea'));

module.exports = {
  ...contract,
  registry,
  github,
  local,
  forgejo,
};
