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
    throw new ValidationError('GitLab group and project must be plain path segments');
  }
  return value;
}

/** GitLab projects may live under subgroups, so keep every owner segment. */
function splitRepoPath(pathname) {
  const path = stripGitSuffix(String(pathname || '').replace(/^\/+|\/+$/g, ''));
  const parts = path.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new ValidationError('GitLab repository must be group/project');
  }
  const repo = repoName(parts.pop());
  const owner = parts.map(part => repoName(part)).join('/');
  return { owner, repo };
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
  // A relative URL root prefixes the clone path; strip it so a shorthand
  // expansion round-trips through this parser.
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

function projectKey(parsed) {
  return encodeURIComponent(`${parsed.owner}/${parsed.repo}`);
}

function branchNameFor(ticketId, ticketTitle) {
  return `vibecode/ticket-${ticketId}-${String(ticketTitle)
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)}`;
}

/**
 * GitLab's merge-request URL ends in `/-/merge_requests/<iid>`; the API state
 * is `opened`, which we normalise to the `open` used by the other providers.
 */
function reviewState(value) {
  return value === 'opened' ? 'open' : value;
}

function parseChanges(data) {
  const changes = Array.isArray(data && data.changes) ? data.changes : [];
  return changes.map((change) => {
    const oldPath = String(change.old_path || '');
    const newPath = String(change.new_path || '');
    const filename = newPath || oldPath;
    const diff = String(change.diff || '');
    let additions = 0;
    let deletions = 0;
    for (const line of diff.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
      else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
    }
    return {
      filename,
      status: change.new_file ? 'added'
        : change.deleted_file ? 'removed'
          : change.renamed_file ? 'renamed' : 'modified',
      additions,
      deletions,
      changes: additions + deletions,
      patch: diff ? `diff --git a/${oldPath} b/${newPath}\n${diff}` : '',
    };
  });
}

class GitLabGitProvider {
  constructor(config = {}) {
    this.id = 'gitlab';
    this.capabilities = getCapabilities(this.id);
    this.config = config;
    this.baseUrl = String(config.baseUrl || '').replace(/\/+$/, '');
    this.token = config.credential || config.token || '';
    this.authMode = config.authMode || 'pat';
  }

  get apiBase() {
    if (!this.baseUrl) throw new ValidationError('gitlab base URL is required');
    return `${this.baseUrl}/api/v4`;
  }

  parseRepoUrl(repoUrl) {
    const raw = String(repoUrl || '').trim();
    if (!raw) throw new ValidationError('Repository URL is required');
    const base = baseOrigin(this.baseUrl, this.id);
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return parseFullUrl(raw, base);
    const scp = parseScp(raw, base);
    if (scp) return scp;
    if (/[\s@:?\\]/.test(raw) || !/^[^/]+\/.+$/.test(raw)) {
      throw new ValidationError('GitLab repository must be group/project');
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
    if (!this.token) throw new ValidationError('gitlab token is required');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(this.apiBase + path, {
        method,
        headers: {
          'PRIVATE-TOKEN': this.token,
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

  _projectId(projectRepo) {
    const explicit = projectRepo && projectRepo.providerProjectId;
    if (explicit !== null && explicit !== undefined && String(explicit).trim()) {
      return encodeURIComponent(String(explicit).trim());
    }
    return projectKey(this.parseRepoUrl(projectRepo.repoUrl));
  }

  _baseBranch(projectRepo) {
    return projectRepo.defaultBranch || projectRepo.default_branch || 'main';
  }

  async validateRepoAccess(repoUrl, credential = this.token) {
    if (!credential) {
      return { accessible: false, defaultBranch: null, error: 'A token is required' };
    }
    this.token = credential;
    try {
      const parsed = this.parseRepoUrl(repoUrl);
      const { response, text } = await this.request(
        'GET', `/projects/${projectKey(parsed)}`);
      if (!response.ok) {
        return { accessible: false, defaultBranch: null, error: `HTTP ${response.status}` };
      }
      const data = JSON.parse(text);
      return {
        accessible: true,
        defaultBranch: data.default_branch || null,
        private: data.visibility !== 'public',
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

  async getFileContent(projectRepo, path, ref = null) {
    const encodedPath = encodeURIComponent(String(path || '').replace(/^\/+/, ''));
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const { response, text } = await this.request(
      'GET',
      `/projects/${this._projectId(projectRepo)}/repository/files/${encodedPath}/raw${query}`,
      { accept: 'text/plain' }
    );
    return response.ok ? text : null;
  }

  async createBranch(projectRepo, ticketId, ticketTitle) {
    const branchName = branchNameFor(ticketId, ticketTitle);
    const { response, text } = await this.request(
      'POST',
      `/projects/${this._projectId(projectRepo)}/repository/branches`,
      { body: { branch: branchName, ref: this._baseBranch(projectRepo) } }
    );
    if (response.ok) return branchName;
    if ((response.status === 400 || response.status === 409)
        && /already exists/i.test(text)) {
      return branchName;
    }
    throw new ValidationError(`Failed to create branch ${branchName}: HTTP ${response.status}`);
  }

  async deleteBranch(projectRepo, branchName) {
    const { response } = await this.request(
      'DELETE',
      `/projects/${this._projectId(projectRepo)}/repository/branches/`
        + encodeURIComponent(branchName)
    );
    if (!response.ok && response.status !== 404) {
      throw new ValidationError(`Failed to delete branch ${branchName}: HTTP ${response.status}`);
    }
  }

  async listBranches(projectRepo) {
    const { response, text } = await this.request(
      'GET',
      `/projects/${this._projectId(projectRepo)}/repository/branches?per_page=100`
    );
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
      number: data.iid,
      url: data.web_url,
      state: reviewState(data.state),
    };
  }

  async _findReview(projectRepo, branchName) {
    const { response, text } = await this.request(
      'GET',
      `/projects/${this._projectId(projectRepo)}/merge_requests?state=opened`
        + `&source_branch=${encodeURIComponent(branchName)}`
    );
    if (!response.ok) return null;
    const existing = JSON.parse(text).find(
      merge => merge && merge.source_branch === branchName);
    return existing ? this._formatReview(existing) : null;
  }

  async createReviewRequest(projectRepo, ticketId, ticketTitle, branchName, description) {
    const { response, text } = await this.request(
      'POST',
      `/projects/${this._projectId(projectRepo)}/merge_requests`,
      {
        body: {
          source_branch: branchName,
          target_branch: this._baseBranch(projectRepo),
          title: `[Ticket #${ticketId}] ${ticketTitle}`,
          description: description || '',
        },
      }
    );
    if (response.ok) return this._formatReview(JSON.parse(text));
    if ((response.status === 400 || response.status === 409)
        && /already exists/i.test(text)) {
      const existing = await this._findReview(projectRepo, branchName);
      if (existing) return existing;
    }
    throw new ValidationError(`Failed to create review request: HTTP ${response.status}`);
  }

  async listReviewRequests(projectRepo) {
    const { response, text } = await this.request(
      'GET',
      `/projects/${this._projectId(projectRepo)}/merge_requests?state=opened&per_page=100`
    );
    if (!response.ok) {
      throw new ValidationError(`Failed to list review requests: HTTP ${response.status}`);
    }
    return JSON.parse(text)
      .filter(merge => merge && String(merge.source_branch || '')
        .startsWith('vibecode/ticket-'))
      .map(merge => this._formatReview(merge));
  }

  async getReviewRequest(projectRepo, reviewNumber) {
    const { response, text } = await this.request(
      'GET',
      `/projects/${this._projectId(projectRepo)}/merge_requests/`
        + encodeURIComponent(reviewNumber)
    );
    if (!response.ok) {
      throw new ValidationError(`Failed to read review request: HTTP ${response.status}`);
    }
    const data = JSON.parse(text);
    if (!data.source_branch || !data.sha) return null;
    return {
      number: data.iid,
      branch: data.source_branch,
      headSha: data.sha,
      url: data.web_url,
      state: reviewState(data.state),
    };
  }

  async getReviewDiff(projectRepo, reviewNumber) {
    const { response, text } = await this.request(
      'GET',
      `/projects/${this._projectId(projectRepo)}/merge_requests/`
        + encodeURIComponent(reviewNumber) + '/changes'
    );
    if (!response.ok) {
      throw new ValidationError(`Failed to read review diff: HTTP ${response.status}`);
    }
    return {
      files: parseChanges(JSON.parse(text)),
      prNumber: Number(reviewNumber),
    };
  }
}

function createProvider(config) {
  return new GitLabGitProvider(config);
}

module.exports = { GitLabGitProvider, createProvider };
