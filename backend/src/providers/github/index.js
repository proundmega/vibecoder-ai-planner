const { GitHubAPI } = require('./api');
const { validatePAT, validateRepoAccess, parseRepoUrl } = require('./auth');
const { createTicketBranch, deleteTicketBranch, listTicketBranches } = require('./branch');
const { createTicketPR, listTicketPRs } = require('./pr');

class GitHubProvider {
  constructor(token) {
    this.token = token;
    this.api = new GitHubAPI(token);
  }

  static async validatePAT(token) {
    return validatePAT(token);
  }

  static async validateRepoAccess(token, owner, repo) {
    return validateRepoAccess(token, owner, repo);
  }

  static parseRepoUrl(repoUrl) {
    return parseRepoUrl(repoUrl);
  }

  async createBranch(projectRepo, ticketId, ticketTitle) {
    return createTicketBranch(this.api, projectRepo, ticketId, ticketTitle);
  }

  async deleteBranch(projectRepo, branchName) {
    return deleteTicketBranch(this.api, projectRepo, branchName);
  }

  async listBranches(projectRepo) {
    return listTicketBranches(this.api, projectRepo);
  }

  async createPR(projectRepo, ticketId, ticketTitle, branchName, ticketDescription) {
    return createTicketPR(this.api, projectRepo, ticketId, ticketTitle, branchName, ticketDescription);
  }

  async listPRs(projectRepo) {
    return listTicketPRs(this.api, projectRepo);
  }
}

module.exports = { GitHubProvider };
