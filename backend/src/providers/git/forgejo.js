const { ValidationError } = require('../../errors/HttpError');
const { getCapabilities } = require('./GitProvider');

const REQUEST_TIMEOUT_MS = 10_000;
const REPO_SEGMENT = /^[A-Za-z0-9._-]+$/;

function lowerHost(value) {
  return String(value || '').toLowerCase().replace(/\.+$/, '');
}

function stripGitSuffix(value) {
  return value.replace(/\.git$/i, '');
}

function repoName(value) {
  if (!REPO_SEGMENT.test(value) || value === '.' || value === '..') {
    throw new ValidationError('Forgejo/Gitea owner and repository must be plain path segments');
  }
  return value;
}

function splitRepoPath(pathname) {
  const path = stripGitSuffix(String(pathname || '').replace(/^\/+|\/+$/g, ''));
  const parts = path.split('/').filter(Boolean);
  if (parts.length !== 2) {
    throw new ValidationError('Forgejo/Gitea repository must be owner/repo');
  }
  return { owner: repoName(parts[0]), repo: repoName(parts[1]) };
}

function repoPath(owner, repo) {
  return `${encodeURIComponent(repoName(owner))}/${encodeURIComponent(repoName(repo))}`;
}

function baseOrigin(baseUrl, id) {
  if (!baseUrl) throw new ValidationError(`${id} base URL is required`);
  try {
    return new URL(baseUrl);
  } catch {
    throw new ValidationError(`${id} base URL must be an absolute URL`);
  }
}

function assertBaseHost(hostname, base) {
  if (lowerHost(hostname) !== lowerHost(base.hostname)) {
    throw new ValidationError('Repository URL host must match the provider base URL');
  }
}

function assertHttpOrigin(url, base) {
  const defaultPort = protocol => (protocol === 'https:' ? '443' : '80');
  const samePort = (url.port || defaultPort(url.protocol))
    === (base.port || defaultPort(base.protocol));
  if (url.protocol !== base.protocol || !samePort) {
    throw new ValidationError('Repository URL scheme and port must match the provider base URL');
  }
  assertBaseHost(url.hostname, base);
}

function parseFullUrl(raw, base) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError('Repository URL must be an absolute URL');
  }
  const ssh = url.protocol === 'ssh:';
  const basePath = String(base.pathname || '').replace(/\/+$/, '');
  if (!ssh && url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ValidationError('Repository URL must use http, https or ssh');
  }
  if (url.search || url.hash) {
    throw new ValidationError('Repository URL must not contain a query or fragment');
  }
  if (ssh) {
    const user = (url.username || '').toLowerCase();
    if (url.password || (user && user !== 'git')) {
      throw new ValidationError('SSH repository URL must use the git user without a password');
    }
    assertBaseHost(url.hostname, base);
  } else {
    // HTTP(S) credentials never belong in a stored URL; the token is separate.
    if (url.username || url.password) {
      throw new ValidationError('Repository URLs must not contain credentials');
    }
    assertHttpOrigin(url, base);
    if (basePath && url.pathname !== basePath
        && !url.pathname.startsWith(`${basePath}/`)) {
      throw new ValidationError('Repository URL must be under the provider base URL path');
    }
  }
  // A sub-path installation puts the repository under the base path; strip it
  // so a shorthand-expanded clone URL round-trips through this parser.
  const pathname = !ssh && basePath && url.pathname.startsWith(`${basePath}/`)
    ? url.pathname.slice(basePath.length)
    : url.pathname;
  const { owner, repo } = splitRepoPath(pathname);
  return {
    host: lowerHost(url.hostname),
    protocol: ssh ? 'ssh' : url.protocol.replace(':', ''),
    owner,
    repo,
    cloneUrl: url.toString(),
  };
}

function parseScp(raw, base) {
  const match = /^(?:([^@/\s]+)@)?([^:/\s]+):(.+)$/.exec(raw);
  if (!match) return null;
  const user = (match[1] || '').toLowerCase();
  if (user && user !== 'git') {
    throw new ValidationError('SSH repository URL must use the git user');
  }
  assertBaseHost(match[2], base);
  const { owner, repo } = splitRepoPath(match[3]);
  return {
    host: lowerHost(match[2]),
    protocol: 'ssh',
    owner,
    repo,
    cloneUrl: raw,
  };
}

/**
 * Extract the two paths from a `diff --git a/x b/x` header. Git quotes paths
 * that contain spaces or special characters.
 */
function headerPaths(line) {
  const match = /^(?:"a\/(.+)"|a\/(.+)) (?:"b\/(.+)"|b\/(.+))$/.exec(line || '');
  if (!match) return null;
  return { from: match[1] || match[2], to: match[3] || match[4] };
}

/**
 * Parse a unified diff (Forgejo/Gitea `.diff` endpoint) into the same file
 * shape the GitHub provider returns, so review tooling reads both alike.
 */
function parseDiff(text) {
  const files = [];
  for (const block of String(text || '').split(/^diff --git /m).slice(1)) {
    const lines = block.split('\n');
    const header = headerPaths(lines[0]);
    const renamed = /^rename to (.+)$/m.exec(block);
    const added = /^\+\+\+ (?:b\/)?(.+)$/m.exec(block);
    const removed = /^--- (?:a\/)?(.+)$/m.exec(block);
    const filename = (renamed && renamed[1])
      || (added && added[1] !== '/dev/null' && added[1])
      || (removed && removed[1] !== '/dev/null' && removed[1])
      || (header && header.to);
    if (!filename) continue;
    const binary = /^Binary files .* differ$/m.test(block);
    let additions = 0;
    let deletions = 0;
    for (const line of lines.slice(1)) {
      if (line.startsWith('+++') || line.startsWith('---')) continue;
      if (line.startsWith('+')) additions += 1;
      else if (line.startsWith('-')) deletions += 1;
    }
    files.push({
      filename,
      status: /^new file mode/m.test(block) ? 'added'
        : /^deleted file mode/m.test(block) ? 'removed'
          : renamed ? 'renamed' : 'modified',
      additions,
      deletions,
      changes: additions + deletions,
      patch: binary ? '' : `diff --git ${block}`.trimEnd(),
    });
  }
  return files;
}

/** Forgejo/Gitea share the same `/api/v1` surface; the id selects the capability. */
class ForgejoGitProvider {
  constructor(config = {}, id = 'forgejo') {
    this.id = id;
    this.capabilities = getCapabilities(id);
    this.config = config;
    this.baseUrl = String(config.baseUrl || '').replace(/\/+$/, '');
    this.token = config.credential || config.token || '';
    this.authMode = config.authMode || 'pat';
  }

  get apiBase() {
    if (!this.baseUrl) throw new ValidationError(`${this.id} base URL is required`);
    return `${this.baseUrl}/api/v1`;
  }

  parseRepoUrl(repoUrl) {
    const raw = String(repoUrl || '').trim();
    if (!raw) throw new ValidationError('Repository URL is required');
    const base = baseOrigin(this.baseUrl, this.id);
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return parseFullUrl(raw, base);
    const scp = parseScp(raw, base);
    if (scp) return scp;
    if (/[\s@:?\\]/.test(raw) || !/^[^/]+\/[^/]+$/.test(raw)) {
      throw new ValidationError('Forgejo/Gitea repository must be owner/repo');
    }
    const { owner, repo } = splitRepoPath(raw);
    return {
      host: lowerHost(base.hostname),
      protocol: base.protocol.replace(':', ''),
      owner,
      repo,
      cloneUrl: `${this.baseUrl}/${owner}/${repo}.git`,
    };
  }

  async request(method, path, { body = null, accept = 'application/json' } = {}) {
    if (!this.token) throw new ValidationError(`${this.id} token is required`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(this.apiBase + path, {
        method,
        headers: {
          Authorization: `token ${this.token}`,
          Accept: accept,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await response.text();
      return { response, text };
    } finally {
      clearTimeout(timer);
    }
  }

  async validateRepoAccess(repoUrl, credential = this.token) {
    if (!credential) {
      return { accessible: false, defaultBranch: null, error: 'A token is required' };
    }
    this.token = credential;
    try {
      const parsed = this.parseRepoUrl(repoUrl);
      const { response, text } = await this.request(
        'GET', `/repos/${repoPath(parsed.owner, parsed.repo)}`);
      if (!response.ok) {
        return { accessible: false, defaultBranch: null, error: `HTTP ${response.status}` };
      }
      const data = JSON.parse(text);
      return {
        accessible: true,
        defaultBranch: data.default_branch || null,
        private: data.private,
        error: null,
      };
    } catch (error) {
      return { accessible: false, defaultBranch: null, error: error.message };
    }
  }

  async validateCredential(credential = this.token) {
    return { valid: Boolean(credential && String(credential).trim()) };
  }

  async getDefaultBranch(repoUrl) {
    const validation = await this.validateRepoAccess(repoUrl);
    if (!validation.accessible) throw new ValidationError(validation.error);
    return validation.defaultBranch;
  }

  getCloneUrl(repoUrl) {
    return this.parseRepoUrl(repoUrl).cloneUrl;
  }

  async getFileContent() { return null; }

  async createBranch(projectRepo, ticketId, ticketTitle) {
    const parsed = this.parseRepoUrl(projectRepo.repoUrl);
    const branchName = `vibecode/ticket-${ticketId}-${String(ticketTitle)
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)}`;
    const base = projectRepo.defaultBranch || projectRepo.default_branch || 'main';
    const { response, text } = await this.request(
      'POST',
      `/repos/${repoPath(parsed.owner, parsed.repo)}/branches`,
      { body: { new_branch_name: branchName, old_branch_name: base } }
    );
    if (response.ok) return branchName;
    if (response.status === 409 || (response.status === 422 && /already exists/i.test(text))) {
      return branchName;
    }
    throw new ValidationError(`Failed to create branch ${branchName}: HTTP ${response.status}`);
  }

  async deleteBranch(projectRepo, branchName) {
    const parsed = this.parseRepoUrl(projectRepo.repoUrl);
    const { response } = await this.request(
      'DELETE',
      `/repos/${repoPath(parsed.owner, parsed.repo)}/branches/${encodeURIComponent(branchName)}`
    );
    if (!response.ok && response.status !== 404) {
      throw new ValidationError(`Failed to delete branch ${branchName}: HTTP ${response.status}`);
    }
  }

  async listBranches(projectRepo) {
    const parsed = this.parseRepoUrl(projectRepo.repoUrl);
    const { response, text } = await this.request(
      'GET',
      `/repos/${repoPath(parsed.owner, parsed.repo)}/branches`);
    if (!response.ok) {
      throw new ValidationError(`Failed to list branches: HTTP ${response.status}`);
    }
    return JSON.parse(text)
      .map(branch => branch.name)
      .filter(name => name?.startsWith('vibecode/ticket-'));
  }

  _formatReview(data) {
    return {
      id: data.id,
      number: data.number,
      url: data.html_url || data.url,
      state: data.state,
    };
  }

  async _findReview(parsed, branchName) {
    const { response, text } = await this.request(
      'GET',
      `/repos/${repoPath(parsed.owner, parsed.repo)}/pulls?state=open&limit=50`);
    if (!response.ok) return null;
    const existing = JSON.parse(text).find(
      pull => pull && pull.head && pull.head.ref === branchName);
    return existing ? this._formatReview(existing) : null;
  }

  async createReviewRequest(projectRepo, ticketId, ticketTitle, branchName, description) {
    const parsed = this.parseRepoUrl(projectRepo.repoUrl);
    const base = projectRepo.defaultBranch || projectRepo.default_branch || 'main';
    const body = description || '';
    const { response, text } = await this.request(
      'POST',
      `/repos/${repoPath(parsed.owner, parsed.repo)}/pulls`,
      {
        body: {
          title: `[Ticket #${ticketId}] ${ticketTitle}`,
          body,
          head: branchName,
          base,
        },
      }
    );
    if (response.ok) return this._formatReview(JSON.parse(text));
    if (response.status === 409 || (response.status === 422 && /already exists/i.test(text))) {
      const existing = await this._findReview(parsed, branchName);
      if (existing) return existing;
    }
    throw new ValidationError(`Failed to create review request: HTTP ${response.status}`);
  }

  async listReviewRequests(projectRepo) {
    const parsed = this.parseRepoUrl(projectRepo.repoUrl);
    const { response, text } = await this.request(
      'GET',
      `/repos/${repoPath(parsed.owner, parsed.repo)}/pulls?state=open&limit=50`);
    if (!response.ok) {
      throw new ValidationError(`Failed to list review requests: HTTP ${response.status}`);
    }
    return JSON.parse(text)
      .filter(pull => pull && pull.head && String(pull.head.ref || '')
        .startsWith('vibecode/ticket-'))
      .map(pull => this._formatReview(pull));
  }

  async getReviewDiff(projectRepo, reviewNumber) {
    const parsed = this.parseRepoUrl(projectRepo.repoUrl);
    const number = encodeURIComponent(reviewNumber);
    const { response, text } = await this.request(
      'GET',
      `/repos/${repoPath(parsed.owner, parsed.repo)}/pulls/${number}.diff`,
      { accept: 'text/plain' }
    );
    if (!response.ok) {
      throw new ValidationError(`Failed to read review diff: HTTP ${response.status}`);
    }
    return { files: parseDiff(text), prNumber: Number(reviewNumber) };
  }
}

function createProvider(config, id = 'forgejo') {
  return new ForgejoGitProvider(config, id);
}

module.exports = { ForgejoGitProvider, createProvider };
