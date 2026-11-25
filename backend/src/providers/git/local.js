const { ValidationError } = require('../../errors/HttpError');
const { getCapabilities } = require('./GitProvider');

function parseSshPath(raw) {
  const url = new URL(raw);
  return {
    host: url.hostname,
    protocol: 'ssh',
    path: url.pathname.replace(/^\/+/, ''),
    cloneUrl: raw,
  };
}

/**
 * Local bare/SSH provider. There is no review API: the agent pushes a branch
 * and records the SHA; the backend only stores the SSH credential and serves
 * it to the agent.
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
        'Local repositories must use an SSH or filesystem URL');
    }
    if (/^ssh:\/\//i.test(raw)) {
      return parseSshPath(raw);
    }
    if (/^file:\/\//i.test(raw)) {
      const url = new URL(raw);
      return {
        host: null,
        protocol: 'file',
        path: url.pathname,
        cloneUrl: raw,
      };
    }
    if (raw.startsWith('/')) {
      return { host: null, protocol: 'file', path: raw, cloneUrl: raw };
    }
    const scp = /^(?:[^@\s]+@)?([^:/\s]+):(.+)$/.exec(raw);
    if (scp) {
      return {
        host: scp[1],
        protocol: 'ssh',
        path: scp[2],
        cloneUrl: raw,
      };
    }
    throw new ValidationError(
      'Local repository URL must be an SSH URL or an absolute filesystem path');
  }

  async validateRepoAccess(repoUrl, credential = this.config.credential) {
    const parsed = this.parseRepoUrl(repoUrl);
    if (parsed.protocol === 'ssh' && !(credential && String(credential).trim())) {
      return {
        accessible: false,
        defaultBranch: null,
        error: 'An SSH key is required for ssh authentication',
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
