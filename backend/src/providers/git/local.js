const { ValidationError } = require('../../errors/HttpError');
const { getCapabilities, isPrivateHostname } = require('./GitProvider');

function parseSshUrl(raw) {
  const url = new URL(raw);
  if (url.password) {
    throw new ValidationError('SSH URLs must not contain a password');
  }
  const path = url.pathname.replace(/^\/+|\/+$/g, '');
  if (!path) {
    throw new ValidationError('SSH URL must include a repository path');
  }
  return {
    host: url.hostname,
    protocol: 'ssh',
    path,
    cloneUrl: raw,
  };
}

function parseScpLike(raw) {
  const match = /^(?:([^@\s]+)@)?([^:/\s]+):(.+)$/.exec(raw);
  if (!match) return null;
  const userinfo = match[1] || '';
  if (userinfo.includes(':')) {
    throw new ValidationError('SSH URLs must not contain a password');
  }
  const path = match[3].replace(/^\/+|\/+$/g, '');
  if (!path) {
    throw new ValidationError('SSH URL must include a repository path');
  }
  return {
    host: match[2],
    protocol: 'ssh',
    path,
    cloneUrl: raw,
  };
}

function privateHostsAllowed() {
  return process.env.ALLOW_PRIVATE_HOSTS === '1'
    || process.env.GIT_ALLOW_PRIVATE_HOSTS === '1';
}

/**
 * Local bare/SSH provider. There is no review API: the agent pushes a branch
 * and records the SHA; the backend only stores the SSH credential and serves
 * it to the agent.
 *
 * Filesystem paths are intentionally deferred to fg-57d2, where the agent-side
 * repository-root boundary exists; this slice accepts SSH URLs only.
 */
class LocalGitProvider {
  constructor(config) {
    this.id = 'local';
    this.capabilities = getCapabilities('local');
    this.config = config || {};
  }

  parseRepoUrl(repoUrl) {
    const raw = String(repoUrl || '').trim();
    if (!raw) throw new ValidationError('Repository URL is required');
    if (/^https?:\/\//i.test(raw)) {
      throw new ValidationError(
        'Local repositories must use an SSH URL');
    }
    if (/^ssh:\/\//i.test(raw)) {
      return parseSshUrl(raw);
    }
    if (/^file:\/\//i.test(raw) || raw.startsWith('/')) {
      throw new ValidationError(
        'Local filesystem paths are deferred to fg-57d2; use an SSH URL');
    }
    const parsed = parseScpLike(raw);
    if (parsed) return parsed;
    throw new ValidationError(
      'Local repository URL must be an SSH URL');
  }

  async validateRepoAccess(repoUrl, credential = this.config.credential) {
    const parsed = this.parseRepoUrl(repoUrl);
    if (!(credential && String(credential).trim())) {
      return {
        accessible: false,
        defaultBranch: null,
        error: 'An SSH key is required for ssh authentication',
      };
    }
    if (!privateHostsAllowed() && isPrivateHostname(parsed.host)) {
      return {
        accessible: false,
        defaultBranch: null,
        error: 'SSH host is not allowed by the host policy',
      };
    }
    return { accessible: true, defaultBranch: null, error: null };
  }

  async validateCredential(credential = this.config.credential) {
    if (this.config.authMode === 'ssh') {
      return { valid: Boolean(credential && String(credential).trim()) };
    }
    return { valid: true };
  }

  getDefaultBranch() {
    return null;
  }

  getCloneUrl(repoUrl) {
    return this.parseRepoUrl(repoUrl).cloneUrl;
  }

  async getFileContent() {
    return null;
  }

  async createBranch() {
    throw new ValidationError(
      'Branch creation is managed by the agent for local repositories');
  }

  async deleteBranch() {
    throw new ValidationError(
      'Branch deletion is not available for local repositories');
  }

  async listBranches() {
    return [];
  }

  async createReviewRequest() {
    return null;
  }

  async listReviewRequests() {
    return [];
  }

  async getReviewDiff() {
    return { files: [] };
  }
}

function createProvider(config) {
  return new LocalGitProvider(config);
}

module.exports = { LocalGitProvider, createProvider };
