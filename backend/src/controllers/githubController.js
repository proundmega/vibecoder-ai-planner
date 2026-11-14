const Project = require('../models/project');
const GitHubService = require('../services/GitHubService');
const GitHubAppAuthService = require('../services/GitHubAppAuthService');
const { NotFoundError, ForbiddenError } = require('../errors/HttpError');

async function requireProjectAccess(req, projectId, message) {
  const project = await Project.findById(projectId);
  if (!project) throw new NotFoundError('Project not found');
  const requesterId = req.agent ? req.agent.owner_id : req.user?.userId;
  const isSuperAdmin = req.user?.role === 'super_admin';
  if (!isSuperAdmin && String(requesterId) !== String(project.ownerId)) {
    throw new ForbiddenError(message);
  }
  return project;
}

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
    let projectId = req.body.projectId || req.project?.id;

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
    let projectId = req.body.projectId;

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
    let projectId = req.body.projectId;

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
    await requireProjectAccess(
      req,
      projectId,
      'Only the project owner or a super admin can read agent repository config'
    );
    const repo = await GitHubService.getProjectRepoForAgent(projectId);
    
    if (!repo) {
      res.json({ success: true, data: null });
      return;
    }
    
    res.json({
      success: true,
      data: {
        repoUrl: repo.repoUrl,
        accessToken: repo.accessToken,
        authMode: repo.authMode,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function requestToken(req, res, next) {
  try {
    const projectId = Number(req.params.projectId);
    await requireProjectAccess(
      req,
      projectId,
      'Only the project owner or a super admin can request a GitHub token'
    );

    const token = await GitHubAppAuthService.mintToken(projectId, {
      operation: req.body?.operation || 'agent',
      repo: req.body?.repo,
      forceRefresh: req.body?.forceRefresh === true,
    });
    res.json({ success: true, data: token });
  } catch (error) {
    next(error);
  }
}

async function getInstallationStatus(req, res, next) {
  try {
    const projectId = Number(req.params.projectId);
    await requireProjectAccess(
      req,
      projectId,
      'Only the project owner or a super admin can read the GitHub installation'
    );
    const installation = await GitHubAppAuthService.getInstallationStatus(projectId);
    res.json({ success: true, data: installation });
  } catch (error) {
    next(error);
  }
}

async function setInstallation(req, res, next) {
  try {
    const projectId = Number(req.params.projectId);
    await requireProjectAccess(
      req,
      projectId,
      'Only the project owner or a super admin can map a GitHub installation'
    );
    const { installationId, repoAllowlist } = req.body;
    const installation = await GitHubAppAuthService.setInstallation(
      projectId,
      installationId,
      repoAllowlist
    );
    res.json({ success: true, data: installation });
  } catch (error) {
    next(error);
  }
}

async function disableInstallation(req, res, next) {
  try {
    const projectId = Number(req.params.projectId);
    await requireProjectAccess(
      req,
      projectId,
      'Only the project owner or a super admin can disable GitHub access'
    );
    const result = await GitHubAppAuthService.disableProject(projectId);
    res.json({ success: true, data: result });
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
  requestToken,
  getInstallationStatus,
  setInstallation,
  disableInstallation,
};
