const Project = require('../models/project');
const Ticket = require('../models/ticket');
const User = require('../models/user');
const { pool } = require('../db');
const PermissionService = require('../services/PermissionService');
const { GitHubProvider } = require('../providers/github');
const GitHubAppAuthService = require('./GitHubAppAuthService');
const { encrypt, decrypt } = require('../utils/crypto');
const { NotFoundError, ForbiddenError, ValidationError } = require('../errors/HttpError');
const logger = require('../utils/logger');

class GitHubService {
  async connectProject(projectId, repoUrl, accessToken, userId) {
    const project = await Project.findById(projectId);
    if (!project) throw new NotFoundError('Project not found');

    const user = await User.find(userId);
    const isAdmin = await PermissionService.hasPermission(user?.role || 'user', 'PROJECT_MANAGE_MEMBERS');
    if (!isAdmin && String(project.ownerId) !== String(userId)) {
      throw new ForbiddenError('Only project owner or admin can connect a repository');
    }

    const parsed = GitHubProvider.parseRepoUrl(repoUrl);
    const validation = await GitHubProvider.validateRepoAccess(accessToken, parsed.owner, parsed.repo);

    if (!validation.accessible) {
      throw new ValidationError(`Cannot access repository: ${validation.error}`);
    }

    const encryptedToken = accessToken ? encrypt(accessToken) : null;

    
    const result = await pool.query(
      `INSERT INTO project_repos (project_id, provider, repo_url, access_token_encrypted, default_branch, is_active)
       VALUES ($1, 'github', $2, $3, $4, TRUE)
       ON CONFLICT (project_id, provider) DO UPDATE
       SET repo_url = $2, access_token_encrypted = $3, default_branch = $4, is_active = TRUE, updated_at = NOW()
       RETURNING *`,
      [projectId, repoUrl, encryptedToken, validation.defaultBranch]
    );

    return this._formatRepoResult(result.rows[0]);
  }

  async disconnectProject(projectId) {
    const project = await Project.findById(projectId);
    if (!project) throw new NotFoundError('Project not found');

    
    await pool.query(
      'UPDATE project_repos SET is_active = FALSE, updated_at = NOW() WHERE project_id = $1',
      [projectId]
    );

    return { success: true };
  }

  async getProjectRepo(projectId) {
    const project = await Project.findById(projectId);
    if (!project) throw new NotFoundError('Project not found');

    
    const result = await pool.query(
      'SELECT * FROM project_repos WHERE project_id = $1 AND is_active = TRUE',
      [projectId]
    );

    if (result.rows.length === 0) return null;

    return this._formatRepoResult(result.rows[0]);
  }

  async getProjectRepoForAgent(projectId) {
    const result = await pool.query(
      'SELECT * FROM project_repos WHERE project_id = $1 AND is_active = TRUE',
      [projectId]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const mode = GitHubAppAuthService.getAuthMode();
    if (mode === 'app') {
      // App mode never returns a stored PAT; agents request a scoped token from
      // POST /github/:projectId/token instead.
      return { repoUrl: row.repo_url, accessToken: null, authMode: 'app' };
    }
    if (!GitHubAppAuthService.isPatAllowed()) {
      throw new ForbiddenError(
        'PAT fallback is disabled; configure a GitHub App or set ALLOW_PAT=true for local development'
      );
    }
    await GitHubAppAuthService.assertProjectEnabled(projectId);
    if (!row.access_token_encrypted) {
      return { repoUrl: row.repo_url, accessToken: null, authMode: 'pat' };
    }
    return {
      repoUrl: row.repo_url,
      accessToken: decrypt(row.access_token_encrypted),
      authMode: 'pat',
    };
  }

  /**
   * Build a GitHub provider for backend-initiated operations. App mode mints a
   * repo-scoped installation token; PAT mode requires the explicit fallback
   * flag and uses the stored PAT.
   */
  async _createProvider(projectId) {
    if (GitHubAppAuthService.getAuthMode() === 'app') {
      const token = await GitHubAppAuthService.mintToken(projectId, {
        operation: 'backend',
      });
      return new GitHubProvider(token.token);
    }
    if (!GitHubAppAuthService.isPatAllowed()) {
      throw new ForbiddenError(
        'PAT fallback is disabled; configure a GitHub App or set ALLOW_PAT=true for local development'
      );
    }
    await GitHubAppAuthService.assertProjectEnabled(projectId);
    const repo = await this.getProjectRepo(projectId);
    if (!repo) throw new ValidationError('No repository connected to this project');
    return new GitHubProvider(decrypt(repo.accessTokenEncrypted));
  }

  async getProjectRepos(projectId) {
    
    const result = await pool.query(
      'SELECT * FROM project_repos WHERE project_id = $1 AND is_active = TRUE ORDER BY created_at DESC',
      [projectId]
    );

    return result.rows.map(row => this._formatRepoResult(row));
  }

  async createTicketBranch(projectId, ticketId) {
    const repo = await this.getProjectRepo(projectId);
    if (!repo) throw new ValidationError('No repository connected to this project');

    const ticket = await Ticket.findById(ticketId);
    if (!ticket) throw new NotFoundError('Ticket not found');
    if (ticket.projectId !== parseInt(projectId)) {
      throw new ValidationError('Ticket does not belong to this project');
    }

    const provider = await this._createProvider(projectId);
    const branchName = await provider.createBranch(repo, ticket.id, ticket.title);

    
    await pool.query(
      'UPDATE tickets SET branch_name = $1, updated_at = NOW() WHERE id = $2',
      [branchName, ticketId]
    );

    return { branchName, ticketId };
  }

  async createTicketPR(projectId, ticketId, description) {
    const repo = await this.getProjectRepo(projectId);
    if (!repo) throw new ValidationError('No repository connected to this project');

    const ticket = await Ticket.findById(ticketId);
    if (!ticket) throw new NotFoundError('Ticket not found');
    if (ticket.projectId !== parseInt(projectId)) {
      throw new ValidationError('Ticket does not belong to this project');
    }
    if (!ticket.branchName) {
      throw new ValidationError('No branch created for this ticket yet');
    }

    const provider = await this._createProvider(projectId);
    const pr = await provider.createPR(
      repo, ticket.id, ticket.title, ticket.branchName, description || ticket.description
    );

    
    await pool.query(
      'UPDATE tickets SET pr_url = $1, pr_state = $2, updated_at = NOW() WHERE id = $3',
      [pr.url, pr.state, ticketId]
    );

    return { ...pr, ticketId };
  }

  async deleteTicketBranch(projectId, ticketId) {
    const repo = await this.getProjectRepo(projectId);
    if (!repo) throw new ValidationError('No repository connected to this project');

    const ticket = await Ticket.findById(ticketId);
    if (!ticket) throw new NotFoundError('Ticket not found');
    if (!ticket.branchName) return { success: true, message: 'No branch to delete' };

    const provider = await this._createProvider(projectId);
    try {
      await provider.deleteBranch(repo, ticket.branchName);
    } catch (error) {
      logger.warn(`Failed to delete branch ${ticket.branchName}:`, error.message);
    }

    
    await pool.query(
      'UPDATE tickets SET branch_name = NULL, pr_url = NULL, pr_state = NULL, updated_at = NOW() WHERE id = $1',
      [ticketId]
    );

    return { success: true };
  }

  async listTicketBranches(projectId) {
    const repo = await this.getProjectRepo(projectId);
    if (!repo) throw new ValidationError('No repository connected to this project');

    const provider = await this._createProvider(projectId);
    return provider.listBranches(repo);
  }

  async listTicketPRs(projectId) {
    const repo = await this.getProjectRepo(projectId);
    if (!repo) throw new ValidationError('No repository connected to this project');

    const provider = await this._createProvider(projectId);
    return provider.listPRs(repo);
  }

  async getPRDiff(projectId, ticketId) {
    const repo = await this.getProjectRepo(projectId);
    if (!repo) throw new ValidationError('No repository connected to this project');

    const ticket = await Ticket.findById(ticketId);
    if (!ticket) throw new NotFoundError('Ticket not found');
    if (!ticket.prUrl) throw new ValidationError('No PR linked to this ticket');

    const prNumber = this._extractPRNumber(ticket.prUrl);
    const provider = await this._createProvider(projectId);
    return provider.getPRDiff(repo, prNumber);
  }

  _extractPRNumber(prUrl) {
    const match = prUrl.match(/\/pull\/(\d+)$/);
    if (!match) throw new ValidationError(`Invalid PR URL: ${prUrl}`);
    return parseInt(match[1], 10);
  }

  _formatRepoResult(row) {
    return {
      id: row.id,
      projectId: row.project_id,
      provider: row.provider,
      repoUrl: row.repo_url,
      accessTokenEncrypted: row.access_token_encrypted,
      defaultBranch: row.default_branch,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

module.exports = new GitHubService();
