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
    return GitProjectService.disconnect(projectId);
  }

  async getProjectRepo(projectId) {
    return GitProjectService.getRepo(projectId);
  }

  async getProjectRepoForAgent(projectId) {
    return GitProjectService.getAgentCredential(projectId);
  }

  async getProjectRepos(projectId) {
    return GitProjectService.getRepos(projectId);
  }

  async readRepoFile(projectId, path, ref = null) {
    return GitProjectService.readFile(projectId, path, ref);
  }

  async createTicketBranch(projectId, ticketId) {
    const repo = await this.getProjectRepo(projectId);
    return GitProjectService.createBranch(projectId, ticketId, { repo });
  }

  async createTicketPR(projectId, ticketId, description) {
    const repo = await this.getProjectRepo(projectId);
    return GitProjectService.createReviewRequest(projectId, ticketId, description, { repo });
  }

  async deleteTicketBranch(projectId, ticketId) {
    const repo = await this.getProjectRepo(projectId);
    return GitProjectService.deleteBranch(projectId, ticketId, { repo });
  }

  async listTicketBranches(projectId) {
    const repo = await this.getProjectRepo(projectId);
    return GitProjectService.listBranches(projectId, { repo });
  }

  async listTicketPRs(projectId) {
    const repo = await this.getProjectRepo(projectId);
    return GitProjectService.listReviewRequests(projectId, { repo });
  }

  async getPRDiff(projectId, ticketId) {
    const repo = await this.getProjectRepo(projectId);
    return GitProjectService.getReviewDiff(projectId, ticketId, { repo });
  }
}

module.exports = new GitHubService();
