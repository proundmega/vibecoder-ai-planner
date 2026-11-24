const GitProjectService = require('./GitProjectService');

/**
 * GitHub compatibility facade over `GitProjectService`.
 *
 * The existing `/api/v1/github` routes and callers keep these method names and
 * response shapes; provider-neutral callers use `GitProjectService` directly.
 */
class GitHubService {
  async connectProject(projectId, repoUrl, accessToken, userId) {
    return GitProjectService.connect(projectId, {
      provider: 'github',
      repoUrl,
      token: accessToken,
    }, userId);
  }

  async disconnectProject(projectId) {
    return GitProjectService.disconnect(projectId, { provider: 'github' });
  }

  async getProjectRepo(projectId) {
    return GitProjectService.getRepo(projectId, { provider: 'github' });
  }

  async getProjectRepoForAgent(projectId) {
    return GitProjectService.getAgentCredential(projectId, { provider: 'github' });
  }

  async getProjectRepos(projectId) {
    return GitProjectService.getRepos(projectId, { provider: 'github' });
  }

  async readRepoFile(projectId, path, ref = null) {
    const repo = await this.getProjectRepo(projectId);
    return GitProjectService.readFile(projectId, path, ref, { repo, provider: 'github' });
  }

  async createTicketBranch(projectId, ticketId) {
    const repo = await this.getProjectRepo(projectId);
    return GitProjectService.createBranch(projectId, ticketId, { repo, provider: 'github' });
  }

  async createTicketPR(projectId, ticketId, description) {
    const repo = await this.getProjectRepo(projectId);
    return GitProjectService.createReviewRequest(
      projectId, ticketId, description, { repo, provider: 'github' });
  }

  async deleteTicketBranch(projectId, ticketId) {
    const repo = await this.getProjectRepo(projectId);
    return GitProjectService.deleteBranch(projectId, ticketId, { repo, provider: 'github' });
  }

  async listTicketBranches(projectId) {
    const repo = await this.getProjectRepo(projectId);
    return GitProjectService.listBranches(projectId, { repo, provider: 'github' });
  }

  async listTicketPRs(projectId) {
    const repo = await this.getProjectRepo(projectId);
    return GitProjectService.listReviewRequests(projectId, { repo, provider: 'github' });
  }

  async getPRDiff(projectId, ticketId) {
    const repo = await this.getProjectRepo(projectId);
    return GitProjectService.getReviewDiff(projectId, ticketId, { repo, provider: 'github' });
  }
}

module.exports = new GitHubService();
