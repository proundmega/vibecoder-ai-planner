const GitHubService = require('../services/GitHubService');
const { NotFoundError } = require('../errors/HttpError');

async function connectRepo(req, res, next) {
  try {
    const projectId = req.params.projectId;
    const { repoUrl, accessToken } = req.body;

    const repo = await GitHubService.connectProject(projectId, repoUrl, accessToken, req.user.userId);
    res.status(201).json({ success: true, data: repo });
  } catch (error) {
    next(error);
  }
}

async function disconnectRepo(req, res, next) {
  try {
    const projectId = req.params.projectId;
    await GitHubService.disconnectProject(projectId);
    res.json({ success: true, data: { message: 'Repository disconnected' } });
  } catch (error) {
    next(error);
  }
}

async function getRepoStatus(req, res, next) {
  try {
    const projectId = req.params.projectId;
    const repo = await GitHubService.getProjectRepo(projectId);
    res.json({ success: true, data: repo });
  } catch (error) {
    next(error);
  }
}

async function createBranch(req, res, next) {
  try {
    const { ticketId } = req.params;
    const projectId = req.body.projectId || req.project?.id;

    if (!projectId) {
      const Ticket = require('../models/ticket');
      const ticket = await Ticket.findById(ticketId);
      if (!ticket) throw new NotFoundError('Ticket not found');
      projectId = ticket.projectId;
    }

    const result = await GitHubService.createTicketBranch(projectId, ticketId);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

async function createPR(req, res, next) {
  try {
    const { ticketId } = req.params;
    const { description } = req.body;
    const projectId = req.body.projectId;

    if (!projectId) {
      const Ticket = require('../models/ticket');
      const ticket = await Ticket.findById(ticketId);
      if (!ticket) throw new NotFoundError('Ticket not found');
      projectId = ticket.projectId;
    }

    const result = await GitHubService.createTicketPR(projectId, ticketId, description);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

async function deleteBranch(req, res, next) {
  try {
    const { ticketId } = req.params;
    const projectId = req.body.projectId;

    if (!projectId) {
      const Ticket = require('../models/ticket');
      const ticket = await Ticket.findById(ticketId);
      if (!ticket) throw new NotFoundError('Ticket not found');
      projectId = ticket.projectId;
    }

    const result = await GitHubService.deleteTicketBranch(projectId, ticketId);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

async function listBranches(req, res, next) {
  try {
    const projectId = req.params.projectId || req.project?.id;
    const branches = await GitHubService.listTicketBranches(projectId);
    res.json({ success: true, data: branches });
  } catch (error) {
    next(error);
  }
}

async function listPRs(req, res, next) {
  try {
    const projectId = req.params.projectId || req.project?.id;
    const prs = await GitHubService.listTicketPRs(projectId);
    res.json({ success: true, data: prs });
  } catch (error) {
    next(error);
  }
}

async function getRepoForAgent(req, res, next) {
  try {
    const projectId = req.params.projectId;
    const repo = await GitHubService.getProjectRepo(projectId);
    
    if (!repo) {
      res.json({ success: true, data: null });
      return;
    }
    
    res.json({ success: true, data: { repoUrl: repo.repo_url, accessToken: repo.access_token } });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  connectRepo,
  disconnectRepo,
  getRepoStatus,
  getRepoForAgent,
  createBranch,
  createPR,
  deleteBranch,
  listBranches,
  listPRs,
};
