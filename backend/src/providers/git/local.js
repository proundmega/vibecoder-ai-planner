const dns = require('dns');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { execFileSync } = require('child_process');
const { fileURLToPath, pathToFileURL } = require('url');
const { ValidationError } = require('../../errors/HttpError');
const { getCapabilities, isPrivateHostname } = require('./GitProvider');

function parseSshUrl(raw) {
  const url = new URL(raw);
  if (url.password || url.username.includes(':') || /%3a/i.test(url.username)) {
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
  if (userinfo.includes(':') || /%3a/i.test(userinfo)) {
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

function localGitRoot() {
  const root = process.env.LOCAL_GIT_ROOT || process.env.GIT_LOCAL_ROOT;
  if (!root || !String(root).trim()) return null;
  const value = String(root).trim();
  return path.isAbsolute(value) ? value : null;
}

/**
 * Resolve a filesystem repository path under the configured root. Symlinks
 * are resolved before the containment check, so a link inside the root cannot
 * point at `/etc` or another repository tree.
 */
function parseFilePath(raw) {
  let candidate;
  if (/^file:\/\//i.test(raw)) {
    try {
      candidate = fileURLToPath(raw);
    } catch {
      throw new ValidationError('Invalid local repository URL');
    }
  } else if (path.isAbsolute(raw)) {
    candidate = raw;
  } else {
    return null;
  }

  const root = localGitRoot();
  if (!root) {
    throw new ValidationError(
      'Local filesystem repositories require LOCAL_GIT_ROOT on the backend');
  }

  let rootReal;
  let repoReal;
  try {
    rootReal = fs.realpathSync(root);
    repoReal = fs.realpathSync(candidate);
  } catch {
    throw new ValidationError('Local repository path does not exist');
  }
  const relative = path.relative(rootReal, repoReal);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ValidationError('Local repository path is outside LOCAL_GIT_ROOT');
  }
  return {
    host: 'local',
    protocol: 'file',
    path: repoReal,
    cloneUrl: pathToFileURL(repoReal).toString(),
  };
}

function gitOutput(repoPath, args) {
  return execFileSync('git', ['-C', repoPath, ...args], {
    encoding: 'utf8',
    timeout: 10000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Local bare/SSH provider. There is no review API: the agent pushes a branch
 * and records the SHA. SSH URLs carry a deploy key; filesystem paths are
 * accepted only under LOCAL_GIT_ROOT and need no credential.
 */
class LocalGitProvider {
  constructor(config) {
    this.id = 'local';
    this.capabilities = getCapabilities('local');
    this.config = config || {};
    this.lookup = this.config.lookup || dns.promises.lookup;
  }

  parseRepoUrl(repoUrl) {
    const raw = String(repoUrl || '').trim();
    if (!raw) throw new ValidationError('Repository URL is required');
    if (/^file:\/\//i.test(raw) || path.isAbsolute(raw)) {
      return parseFilePath(raw);
    }
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
    if (parsed.protocol === 'file') {
      try {
        const isBare = gitOutput(parsed.path, ['rev-parse', '--is-bare-repository']) === 'true';
        if (!isBare) {
          const top = gitOutput(parsed.path, ['rev-parse', '--show-toplevel']);
          if (fs.realpathSync(top) !== parsed.path) {
            return {
              accessible: false,
              defaultBranch: null,
              error: 'Path must be the repository root',
            };
          }
        }
        let defaultBranch = '';
        try {
          defaultBranch = gitOutput(parsed.path, ['symbolic-ref', '--short', 'HEAD']);
        } catch {
          // Detached or non-bare HEAD; fall through to the abbreviated name.
        }
        if (!defaultBranch || defaultBranch === 'HEAD') {
          try {
            defaultBranch = gitOutput(parsed.path, ['rev-parse', '--abbrev-ref', 'HEAD']);
          } catch {
            defaultBranch = '';
          }
        }
        return {
          accessible: true,
          defaultBranch: defaultBranch && defaultBranch !== 'HEAD' ? defaultBranch : null,
          error: null,
        };
      } catch {
        return {
          accessible: false,
          defaultBranch: null,
          error: 'Path is not a git repository',
        };
      }
    }
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
    if (!privateHostsAllowed()) {
      const host = parsed.host.replace(/^\[|\]$/g, '');
      if (!net.isIP(host)) {
        let addresses;
        try {
          addresses = await this.lookup(host, { all: true, verbatim: true });
        } catch {
          return {
            accessible: false,
            defaultBranch: null,
            error: 'SSH host could not be resolved',
          };
        }
        if (!Array.isArray(addresses) || addresses.length === 0) {
          return {
            accessible: false,
            defaultBranch: null,
            error: 'SSH host could not be resolved',
          };
        }
        if (addresses.some(entry => isPrivateHostname(entry.address))) {
          return {
            accessible: false,
            defaultBranch: null,
            error: 'SSH host is not allowed by the host policy',
          };
        }
      }
    }
    return { accessible: true, defaultBranch: null, error: null };
  }

  async validateCredential(credential = this.config.credential) {
    if (this.config.authMode === 'none') {
      return { valid: true };
    }
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
