const Project = require('../models/project');
const Ticket = require('../models/ticket');
const PermissionService = require('../services/PermissionService');
const { GitHubProvider } = require('../providers/github');
const { encrypt, decrypt } = require('../utils/crypto');
const { NotFoundError, ForbiddenError, ValidationError } = require('../errors/HttpError');

class GitHubService {
  async connectProject(projectId, repoUrl, accessToken, userId) {
    const project = await Project.findById(projectId);
    if (!project) throw new NotFoundError('Project not found');

    const user = await require('../models/user').find(userId);
    const isAdmin = await PermissionService.hasPermission(user?.role || 'user', 'PROJECT_MANAGE_MEMBERS');
    if (!isAdmin && project.ownerId !== parseInt(userId)) {
      throw new ForbiddenError('Only project owner or admin can connect a repository');
    }

    const parsed = GitHubProvider.parseRepoUrl(repoUrl);
    const validation = await GitHubProvider.validateRepoAccess(accessToken, parsed.owner, parsed.repo);

    if (!validation.accessible) {
      throw new ValidationError(`Cannot access repository: ${validation.error}`);
    }

    const encryptedToken = encrypt(accessToken);

    const { pool } = require('../db');
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

    const { pool } = require('../db');
    await pool.query(
      'UPDATE project_repos SET is_active = FALSE, updated_at = NOW() WHERE project_id = $1',
      [projectId]
    );

    return { success: true };
  }

  async getProjectRepo(projectId) {
    const project = await Project.findById(projectId);
    if (!project) throw new NotFoundError('Project not found');

    const { pool } = require('../db');
    const result = await pool.query(
      'SELECT * FROM project_repos WHERE project_id = $1 AND is_active = TRUE',
      [projectId]
    );

    if (result.rows.length === 0) return null;

    return this._formatRepoResult(result.rows[0]);
  }

  async getProjectRepos(projectId) {
    const { pool } = require('../db');
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

    const provider = new GitHubProvider(decrypt(repo.accessTokenEncrypted));
    const branchName = await provider.createBranch(repo, ticket.id, ticket.title);

    const { pool } = require('../db');
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

    const provider = new GitHubProvider(decrypt(repo.accessTokenEncrypted));
    const pr = await provider.createPR(
      repo, ticket.id, ticket.title, ticket.branchName, description || ticket.description
    );

    const { pool } = require('../db');
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

    const provider = new GitHubProvider(decrypt(repo.accessTokenEncrypted));
    try {
      await provider.deleteBranch(repo, ticket.branchName);
    } catch (error) {
      console.warn(`Failed to delete branch ${ticket.branchName}:`, error.message);
    }

    const { pool } = require('../db');
    await pool.query(
      'UPDATE tickets SET branch_name = NULL, pr_url = NULL, pr_state = NULL, updated_at = NOW() WHERE id = $1',
      [ticketId]
    );

    return { success: true };
  }

  async listTicketBranches(projectId) {
    const repo = await this.getProjectRepo(projectId);
    if (!repo) throw new ValidationError('No repository connected to this project');

    const provider = new GitHubProvider(decrypt(repo.accessTokenEncrypted));
    return provider.listBranches(repo);
  }

  async listTicketPRs(projectId) {
    const repo = await this.getProjectRepo(projectId);
    if (!repo) throw new ValidationError('No repository connected to this project');

    const provider = new GitHubProvider(decrypt(repo.accessTokenEncrypted));
    return provider.listPRs(repo);
  }

  async getPRDiff(projectId, ticketId) {
    const repo = await this.getProjectRepo(projectId);
    if (!repo) throw new ValidationError('No repository connected to this project');

    const ticket = await Ticket.findById(ticketId);
    if (!ticket) throw new NotFoundError('Ticket not found');
    if (!ticket.prUrl) throw new ValidationError('No PR linked to this ticket');

    const prNumber = this._extractPRNumber(ticket.prUrl);
    const provider = new GitHubProvider(decrypt(repo.accessTokenEncrypted));
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
      defaultBranch: row.default_branch,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

module.exports = new GitHubService();
