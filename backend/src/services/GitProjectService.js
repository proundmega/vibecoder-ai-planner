const Project = require('../models/project');
const Ticket = require('../models/ticket');
const User = require('../models/user');
const path = require('path');
const { pool } = require('../db');
const PermissionService = require('./PermissionService');
const GitHubAppAuthService = require('./GitHubAppAuthService');
const { encrypt, decrypt } = require('../utils/crypto');
const { NotFoundError, ForbiddenError, ValidationError } = require('../errors/HttpError');
const logger = require('../utils/logger');
const gitProviders = require('../providers/git');

/**
 * Provider-neutral repository connection and publish service.
 *
 * `GitHubService` remains the compatibility facade for the existing `/github`
 * routes; this service owns validation, credential storage and provider
 * operations for every registered Git provider.
 */
class GitProjectService {
  async connect(projectId, input = {}, userId) {
    const project = await Project.findById(projectId);
    if (!project) throw new NotFoundError('Project not found');

    const user = await User.find(userId);
    const isAdmin = await PermissionService.hasPermission(
      user?.role || 'user', 'PROJECT_MANAGE_MEMBERS');
    if (!isAdmin && String(project.ownerId) !== String(userId)) {
      throw new ForbiddenError('Only project owner or admin can connect a repository');
    }

    const providerId = gitProviders.normalizeProviderId(input.provider || 'github');
    const capabilities = gitProviders.getCapabilities(providerId);
    const globalGithubMode = providerId === 'github'
      ? GitHubAppAuthService.getAuthMode()
      : null;
    if (providerId === 'github' && input.authMode && input.authMode !== globalGithubMode) {
      throw new ValidationError(
        `GitHub auth mode is deployment-wide (${globalGithubMode}); `
        + `explicit ${input.authMode} is not supported`
      );
    }
    const localFilesystem = providerId === 'local'
      && typeof input.repoUrl === 'string'
      && (/^file:\/\//i.test(input.repoUrl.trim())
        || path.isAbsolute(input.repoUrl.trim()));
    const authMode = input.authMode
      || (providerId === 'github'
        ? globalGithubMode
        : providerId === 'local'
          ? (localFilesystem ? 'none' : 'ssh')
          : 'pat');
    if (!capabilities.authModes.includes(authMode)) {
      throw new ValidationError(`Unsupported auth mode for ${providerId}: ${authMode}`);
    }

    const token = typeof input.token === 'string' && input.token.trim()
      ? input.token.trim()
      : null;
    const sshKey = typeof input.sshKey === 'string' && input.sshKey.trim()
      ? input.sshKey.trim()
      : null;
    if (['pat', 'project_token'].includes(authMode) && !token) {
      throw new ValidationError(`A token is required for ${authMode} authentication`);
    }
    if (authMode === 'ssh' && !sshKey) {
      throw new ValidationError('An SSH key is required for ssh authentication');
    }
    if (capabilities.requiresBaseUrl && !input.baseUrl) {
      throw new ValidationError(`baseUrl is required for ${providerId}`);
    }

    const baseUrl = input.baseUrl ? await gitProviders.assertSafeBaseUrl(input.baseUrl) : null;
    const providerConfig = {
      credential: token || sshKey,
      baseUrl,
      authMode,
    };
    const provider = gitProviders.registry.get(providerId, providerConfig);
    let parsedRepo;
    try {
      parsedRepo = provider.parseRepoUrl(input.repoUrl);
    } catch (error) {
      throw new ValidationError(error.message);
    }
    // Self-hosted providers expand an `owner/repo` shorthand into a clone URL;
    // store that canonical form so the agent receives a usable remote.
    // Self-hosted providers store their canonical clone URL; local paths are
    // canonicalized to file:// so the agent and backend agree on the root.
    const repoUrl = parsedRepo.cloneUrl
      && (capabilities.requiresBaseUrl || providerId === 'local')
      ? parsedRepo.cloneUrl
      : input.repoUrl;
    const validation = await provider.validateRepoAccess(repoUrl, token || sshKey);
    if (!validation.accessible) {
      throw new ValidationError(`Cannot access repository: ${validation.error}`);
    }

    const result = await pool.query(
      `INSERT INTO project_repos
         (project_id, provider, repo_url, access_token_encrypted, default_branch, is_active,
          provider_base_url, provider_project_id, auth_mode, ssh_key_encrypted)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7, $8, $9)
       ON CONFLICT (project_id, provider) DO UPDATE
       SET repo_url = EXCLUDED.repo_url,
           access_token_encrypted = EXCLUDED.access_token_encrypted,
           default_branch = EXCLUDED.default_branch,
           provider_base_url = EXCLUDED.provider_base_url,
           provider_project_id = EXCLUDED.provider_project_id,
           auth_mode = EXCLUDED.auth_mode,
           ssh_key_encrypted = EXCLUDED.ssh_key_encrypted,
           is_active = TRUE,
           updated_at = NOW()
       RETURNING *`,
      [
        projectId,
        providerId,
        repoUrl,
        token ? encrypt(token) : null,
        validation.defaultBranch || input.defaultBranch || 'main',
        baseUrl,
        input.providerProjectId || null,
        authMode,
        sshKey ? encrypt(sshKey) : null,
      ]
    );

    return this._formatRepoResult(result.rows[0]);
  }

  async disconnect(projectId, { provider = null } = {}) {
    const project = await Project.findById(projectId);
    if (!project) throw new NotFoundError('Project not found');

    if (provider) {
      await pool.query(
        `UPDATE project_repos
         SET is_active = FALSE, updated_at = NOW()
         WHERE project_id = $1 AND provider = $2`,
        [projectId, provider]
      );
    } else {
      await pool.query(
        'UPDATE project_repos SET is_active = FALSE, updated_at = NOW() WHERE project_id = $1',
        [projectId]
      );
    }

    return { success: true };
  }

  async getRepo(projectId, { provider = null } = {}) {
    const project = await Project.findById(projectId);
    if (!project) throw new NotFoundError('Project not found');

    const row = await this._getRepoRow(projectId, { provider });
    return row ? this._formatRepoResult(row) : null;
  }

  /**
   * Return the credential an agent needs for the active repository. GitHub App
   * mode deliberately returns no stored PAT: the agent requests a scoped token
   * from the existing token route instead.
   */
  async getAgentCredential(projectId, { provider = null } = {}) {
    const row = await this._getRepoRow(projectId, { provider });
    if (!row) return null;

    const providerId = row.provider || 'github';
    if (providerId === 'github') {
      const mode = GitHubAppAuthService.getAuthMode();
      if (mode === 'app') {
        return { repoUrl: row.repo_url, accessToken: null, authMode: 'app' };
      }
      if (!GitHubAppAuthService.isPatAllowed()) {
        throw new ForbiddenError(
          'PAT fallback is disabled; configure a GitHub App or set ALLOW_PAT=true for local development'
        );
      }
      await GitHubAppAuthService.assertProjectEnabled(projectId);
      return {
        repoUrl: row.repo_url,
        accessToken: row.access_token_encrypted ? decrypt(row.access_token_encrypted) : null,
        authMode: 'pat',
      };
    }

    const authMode = row.auth_mode || 'pat';
    return {
      provider: providerId,
      repoUrl: row.repo_url,
      providerBaseUrl: row.provider_base_url || null,
      providerProjectId: row.provider_project_id || null,
      accessToken: authMode === 'ssh'
        ? null
        : (row.access_token_encrypted ? decrypt(row.access_token_encrypted) : null),
      sshKey: authMode === 'ssh' && row.ssh_key_encrypted
        ? decrypt(row.ssh_key_encrypted)
        : null,
      authMode,
    };
  }

  async getRepos(projectId, { provider = null } = {}) {
    const result = provider
      ? await pool.query(
        `SELECT * FROM project_repos
         WHERE project_id = $1 AND provider = $2 AND is_active = TRUE
         ORDER BY created_at DESC`,
        [projectId, provider]
      )
      : await pool.query(
        `SELECT * FROM project_repos
         WHERE project_id = $1 AND is_active = TRUE
         ORDER BY created_at DESC`,
        [projectId]
      );

    return result.rows.map(row => this._formatRepoResult(row));
  }

  async readFile(projectId, path, ref = null, { repo = null, provider = null } = {}) {
    const connected = await this._requireRepo(projectId, repo, { provider });
    return this._withProvider(
      projectId,
      (providerInstance) => providerInstance.getFileContent(connected, path, ref),
      { repo: connected, provider }
    );
  }

  async createBranch(projectId, ticketId, { repo = null, provider = null } = {}) {
    const connected = await this._requireRepo(projectId, repo, { provider });
    const ticket = await this._ticketForProject(ticketId, projectId);

    const branchName = await this._withProvider(
      projectId,
      (providerInstance) => providerInstance.createBranch(connected, ticket.id, ticket.title),
      { repo: connected, provider }
    );

    await pool.query(
      'UPDATE tickets SET branch_name = $1, updated_at = NOW() WHERE id = $2',
      [branchName, ticketId]
    );

    return { branchName, ticketId };
  }

  async createReviewRequest(
    projectId,
    ticketId,
    description,
    { repo = null, provider = null, headBranch = null, baseBranch = null } = {}
  ) {
    const connected = await this._requireRepo(projectId, repo, { provider });
    const ticket = await this._ticketForProject(ticketId, projectId);
    // The harness pushes the branch itself and passes it; human callers use
    // the branch recorded by the branch endpoint.
    const branchName = headBranch || ticket.branchName;
    if (!branchName) {
      throw new ValidationError('No branch created for this ticket yet');
    }
    // Compare against the base the provider would actually use: an omitted
    // baseBranch falls back to the connected repository's default branch.
    const effectiveBase = baseBranch
      || connected.defaultBranch
      || connected.default_branch
      || 'main';
    if (effectiveBase === branchName) {
      throw new ValidationError('The review head and base branch must differ');
    }

    if (headBranch && headBranch !== ticket.branchName) {
      await pool.query(
        'UPDATE tickets SET branch_name = $1, updated_at = NOW() WHERE id = $2',
        [branchName, ticketId]
      );
    }

    // Repo profiles choose the base branch per ticket; providers read the
    // repo's default branch, so override it for this request.
    const target = baseBranch
      ? { ...connected, defaultBranch: baseBranch, default_branch: baseBranch }
      : connected;

    const review = await this._withProvider(
      projectId,
      (providerInstance) => providerInstance.createReviewRequest(
        target, ticket.id, ticket.title, branchName,
        description || ticket.description
      ),
      { repo: connected, provider }
    );

    if (!review) {
      // Branch-only providers (local bare/SSH) publish branch + SHA; the agent
      // records the SHA and the ticket still moves to review through reconcile.
      return { ticketId, branchName };
    }

    // A self-hosted provider is untrusted input: keep only http(s) URLs, and
    // for self-hosted rows only the connected provider origin. A dropped URL
    // leaves the ticket with branch evidence instead of a dangerous link.
    const safeUrl = gitProviders.safeReviewUrl(
      review.url, connected.providerBaseUrl || null);
    if (!safeUrl && review.url) {
      logger.warn(`Dropped an unsafe review URL for ticket ${ticketId}`);
    }
    const safeReview = { ...review, url: safeUrl };

    await pool.query(
      'UPDATE tickets SET pr_url = $1, pr_state = $2, updated_at = NOW() WHERE id = $3',
      [safeReview.url, safeReview.state, ticketId]
    );

    return { ...safeReview, ticketId };
  }

  async deleteBranch(projectId, ticketId, { repo = null, provider = null } = {}) {
    const connected = await this._requireRepo(projectId, repo, { provider });
    const ticket = await this._ticketForProject(ticketId, projectId);
    if (!ticket.branchName) return { success: true, message: 'No branch to delete' };

    try {
      await this._withProvider(
        projectId,
        (providerInstance) => providerInstance.deleteBranch(connected, ticket.branchName),
        { repo: connected, provider }
      );
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      logger.warn(`Failed to delete branch ${ticket.branchName}:`, error.message);
    }

    await pool.query(
      'UPDATE tickets SET branch_name = NULL, pr_url = NULL, pr_state = NULL, updated_at = NOW() WHERE id = $1',
      [ticketId]
    );

    return { success: true };
  }

  async listBranches(projectId, { repo = null, provider = null } = {}) {
    const connected = await this._requireRepo(projectId, repo, { provider });
    return this._withProvider(
      projectId,
      (providerInstance) => providerInstance.listBranches(connected),
      { repo: connected, provider }
    );
  }

  async listReviewRequests(projectId, { repo = null, provider = null } = {}) {
    const connected = await this._requireRepo(projectId, repo, { provider });
    const reviews = await this._withProvider(
      projectId,
      (providerInstance) => providerInstance.listReviewRequests(connected),
      { repo: connected, provider }
    );
    if (!Array.isArray(reviews)) return [];
    const baseUrl = connected.providerBaseUrl || null;
    return reviews.map((review) => ({
      ...review,
      url: gitProviders.safeReviewUrl(review.url, baseUrl),
    }));
  }

  async getReviewRequest(projectId, ticketId, { repo = null, provider = null } = {}) {
    const connected = await this._requireRepo(projectId, repo, { provider });
    const ticket = await this._ticketForProject(ticketId, projectId);
    if (!ticket.prUrl) {
      throw new ValidationError('No review request is linked to this ticket');
    }
    const reviewNumber = this._extractReviewNumber(ticket.prUrl);
    if (!reviewNumber) {
      throw new ValidationError('Could not resolve the review request number');
    }
    const review = await this._withProvider(
      projectId,
      (providerInstance) => (
        typeof providerInstance.getReviewRequest === 'function'
          ? providerInstance.getReviewRequest(connected, reviewNumber)
          : null
      ),
      { repo: connected, provider }
    );
    if (!review || !review.branch || !review.headSha) return null;
    return {
      ...review,
      url: gitProviders.safeReviewUrl(review.url, connected.providerBaseUrl || null),
      ticketId,
    };
  }

  async getReviewDiff(projectId, ticketId, { repo = null, provider = null } = {}) {
    const connected = await this._requireRepo(projectId, repo, { provider });
    const ticket = await this._ticketForProject(ticketId, projectId);
    if (!ticket.prUrl) throw new ValidationError('No PR linked to this ticket');

    const reviewNumber = this._extractReviewNumber(ticket.prUrl);
    return this._withProvider(
      projectId,
      (providerInstance) => providerInstance.getReviewDiff(connected, reviewNumber),
      { repo: connected, provider }
    );
  }

  async _ticketForProject(ticketId, projectId) {
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) throw new NotFoundError('Ticket not found');
    if (String(ticket.projectId) !== String(projectId)) {
      throw new ValidationError('Ticket does not belong to this project');
    }
    return ticket;
  }

  async _requireRepo(projectId, repo = null, { provider = null } = {}) {
    const connected = repo || await this.getRepo(projectId, { provider });
    if (!connected) {
      throw new ValidationError('No repository connected to this project');
    }
    return connected;
  }

  async _getRepoRow(projectId, { provider = null } = {}) {
    const result = provider
      ? await pool.query(
        `SELECT * FROM project_repos
         WHERE project_id = $1 AND provider = $2 AND is_active = TRUE
         ORDER BY created_at DESC LIMIT 1`,
        [projectId, provider]
      )
      : await pool.query(
        `SELECT * FROM project_repos
         WHERE project_id = $1 AND is_active = TRUE
         ORDER BY created_at DESC LIMIT 1`,
        [projectId]
      );
    return result.rows[0] || null;
  }

  /**
   * Build a provider for backend-initiated operations. GitHub App mode mints a
   * repo-scoped installation token; PAT/self-hosted modes decrypt the stored
   * credential. The factory receives the credential, base URL and auth mode.
   */
  async _createProvider(repo, projectId, { provider = null } = {}) {
    const providerId = repo?.provider || provider || 'github';
    if (providerId === 'github') {
      if (GitHubAppAuthService.getAuthMode() === 'app') {
        const token = await GitHubAppAuthService.mintToken(projectId, {
          operation: 'backend',
        });
        return gitProviders.registry.get('github', {
          credential: token.token,
          baseUrl: repo?.providerBaseUrl || null,
          authMode: 'app',
        });
      }
      if (!GitHubAppAuthService.isPatAllowed()) {
        throw new ForbiddenError(
          'PAT fallback is disabled; configure a GitHub App or set ALLOW_PAT=true for local development'
        );
      }
      await GitHubAppAuthService.assertProjectEnabled(projectId);
      const connected = repo || await this.getRepo(projectId, { provider: 'github' });
      if (!connected) throw new ValidationError('No repository connected to this project');
      let encrypted = connected.accessTokenEncrypted;
      let baseUrl = connected.providerBaseUrl || null;
      if (!encrypted) {
        const row = await this._getRepoRow(projectId, { provider: 'github' });
        encrypted = row?.access_token_encrypted || null;
        baseUrl = baseUrl || row?.provider_base_url || null;
      }
      if (!encrypted) {
        throw new ValidationError('No repository connected to this project');
      }
      return gitProviders.registry.get('github', {
        credential: decrypt(encrypted),
        baseUrl,
        authMode: 'pat',
      });
    }

    const row = await this._getRepoRow(projectId, { provider: providerId });
    if (!row) throw new ValidationError('No repository connected to this project');
    const authMode = row.auth_mode || repo?.authMode || 'pat';
    const encrypted = authMode === 'ssh' ? row.ssh_key_encrypted : row.access_token_encrypted;
    return gitProviders.registry.get(providerId, {
      credential: encrypted ? decrypt(encrypted) : null,
      baseUrl: row.provider_base_url || null,
      authMode,
    });
  }

  async _withProvider(projectId, operation, { repo = null, provider = null } = {}) {
    let providerInstance = await this._createProvider(repo, projectId, { provider });
    try {
      return await operation(providerInstance);
    } catch (error) {
      if (GitHubAppAuthService.getAuthMode() !== 'app' || !this._isAuthError(error)) {
        throw error;
      }
      GitHubAppAuthService.clearCacheForProject(projectId);
      providerInstance = await this._createProvider(repo, projectId, { provider });
      return operation(providerInstance);
    }
  }

  _isAuthError(error) {
    const message = String(error && error.message ? error.message : error);
    return /authentication failed|bad credentials|invalid or expired token|\b401\b/i
      .test(message);
  }

  _extractReviewNumber(prUrl) {
    // GitHub uses /pull/<n>, Forgejo/Gitea use /pulls/<n>, and GitLab uses
    // /-/merge_requests/<iid>.
    const match = String(prUrl || '').match(
      /\/(?:pull|pulls|merge_requests)\/(\d+)\/?$/);
    if (!match) throw new ValidationError(`Invalid PR URL: ${prUrl}`);
    return parseInt(match[1], 10);
  }

  _formatRepoResult(row) {
    return {
      id: row.id,
      projectId: row.project_id,
      provider: row.provider || 'github',
      repoUrl: row.repo_url,
      defaultBranch: row.default_branch,
      isActive: row.is_active,
      providerBaseUrl: row.provider_base_url || null,
      providerProjectId: row.provider_project_id || null,
      authMode: row.provider === 'github' || !row.provider
        ? GitHubAppAuthService.getAuthMode()
        : (row.auth_mode || null),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

module.exports = new GitProjectService();
module.exports.GitProjectService = GitProjectService;
