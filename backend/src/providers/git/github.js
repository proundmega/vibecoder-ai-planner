const { GitHubProvider } = require('../github');
const { getCapabilities } = require('./GitProvider');

/**
 * GitHub implementation of the provider-neutral contract.
 *
 * It wraps the existing GitHubProvider so `/github` callers keep the exact
 * behaviour and response shapes; only the entry point is provider-neutral.
 */
class GitHubGitProvider {
  constructor(token) {
    this.id = 'github';
    this.capabilities = getCapabilities('github');
    this.token = token;
    this.provider = new GitHubProvider(token);
  }

  parseRepoUrl(repoUrl) {
    return GitHubProvider.parseRepoUrl(repoUrl);
  }

  async validateRepoAccess(repoUrl, credential = this.token) {
    const parsed = this.parseRepoUrl(repoUrl);
    return GitHubProvider.validateRepoAccess(credential, parsed.owner, parsed.repo);
  }

  async validateCredential(credential = this.token) {
    return GitHubProvider.validatePAT(credential);
  }

  async getDefaultBranch(repoUrl) {
    const validation = await this.validateRepoAccess(repoUrl);
    return validation.defaultBranch;
  }

  getCloneUrl(repoUrl) {
    const parsed = this.parseRepoUrl(repoUrl);
    return `https://github.com/${parsed.owner}/${parsed.repo}.git`;
  }

  async getFileContent(projectRepo, path, ref) {
    return this.provider.getFileContent(projectRepo, path, ref);
  }

  async createBranch(projectRepo, ticketId, ticketTitle) {
    return this.provider.createBranch(projectRepo, ticketId, ticketTitle);
  }

  async deleteBranch(projectRepo, branchName) {
    return this.provider.deleteBranch(projectRepo, branchName);
  }

  async listBranches(projectRepo) {
    return this.provider.listBranches(projectRepo);
  }

  async createReviewRequest(projectRepo, ticketId, ticketTitle, branchName, description) {
    return this.provider.createPR(projectRepo, ticketId, ticketTitle, branchName, description);
  }

  async listReviewRequests(projectRepo) {
    return this.provider.listPRs(projectRepo);
  }

  async getReviewDiff(projectRepo, reviewNumber) {
    return this.provider.getPRDiff(projectRepo, reviewNumber);
  }
}

function createProvider(token) {
  return new GitHubGitProvider(token);
}

module.exports = { GitHubGitProvider, createProvider };
