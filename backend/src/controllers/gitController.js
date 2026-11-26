const Project = require('../models/project');
const Ticket = require('../models/ticket');
const GitProjectService = require('../services/GitProjectService');
const gitProviders = require('../providers/git');
const { NotFoundError, ForbiddenError } = require('../errors/HttpError');

function requestedProvider(req) {
  const value = req.query?.provider ?? req.body?.provider;
  if (value == null || value === '') return null;
  return String(value).toLowerCase();
}

/**
 * The legacy GitHub connect body uses `accessToken`; accept it as an alias for
 * the provider-neutral `token` field.
 */
function connectInput(body = {}) {
  const input = { ...body };
  if (!input.token && input.accessToken) input.token = input.accessToken;
  delete input.accessToken;
  return input;
}

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

async function projectForTicket(ticketId) {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw new NotFoundError('Ticket not found');
  return ticket.projectId;
}

function send(res, data, status = 200) {
  res.status(status).json({ success: true, data });
}

async function listProviders(req, res, next) {
  try {
    send(res, gitProviders.registry.list());
  } catch (error) {
    next(error);
  }
}

async function connectRepo(req, res, next) {
  try {
    const projectId = req.params.projectId;
    const repo = await GitProjectService.connect(
      projectId,
      connectInput(req.body),
      req.user.userId
    );
    send(res, repo, 201);
  } catch (error) {
    next(error);
  }
}

async function disconnectRepo(req, res, next) {
  try {
    const projectId = req.params.projectId;
    const result = await GitProjectService.disconnect(projectId, {
      provider: requestedProvider(req),
    });
    send(res, result);
  } catch (error) {
    next(error);
  }
}

async function getRepoStatus(req, res, next) {
  try {
    const projectId = req.params.projectId;
    await requireProjectAccess(req, projectId, 'Only the project owner or a super admin can read repository status');
    const repo = await GitProjectService.getRepo(projectId, {
      provider: requestedProvider(req),
    });
    send(res, repo);
  } catch (error) {
    next(error);
  }
}

async function listRepos(req, res, next) {
  try {
    const projectId = req.params.projectId;
    await requireProjectAccess(req, projectId, 'Only the project owner or a super admin can list repositories');
    const repos = await GitProjectService.getRepos(projectId, {
      provider: requestedProvider(req),
    });
    send(res, repos);
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
    const credential = await GitProjectService.getAgentCredential(projectId, {
      provider: requestedProvider(req),
    });
    // GitHub's legacy credential shape omits the provider; identify it here so
    // the generic route is consistent for every provider.
    send(res, credential && {
      provider: credential.provider || 'github',
      ...credential,
    });
  } catch (error) {
    next(error);
  }
}

async function listBranches(req, res, next) {
  try {
    const projectId = req.params.projectId;
    await requireProjectAccess(req, projectId, 'Only the project owner or a super admin can list branches');
    const branches = await GitProjectService.listBranches(projectId, {
      provider: requestedProvider(req),
    });
    send(res, branches);
  } catch (error) {
    next(error);
  }
}

async function createBranch(req, res, next) {
  try {
    const projectId = await projectForTicket(req.params.ticketId);
    await requireProjectAccess(req, projectId, 'Only the project owner or a super admin can create a branch');
    const result = await GitProjectService.createBranch(projectId, req.params.ticketId, {
      provider: requestedProvider(req),
    });
    send(res, result, 201);
  } catch (error) {
    next(error);
  }
}

async function deleteBranch(req, res, next) {
  try {
    const projectId = await projectForTicket(req.params.ticketId);
    await requireProjectAccess(req, projectId, 'Only the project owner or a super admin can delete a branch');
    const result = await GitProjectService.deleteBranch(projectId, req.params.ticketId, {
      provider: requestedProvider(req),
    });
    send(res, result);
  } catch (error) {
    next(error);
  }
}

async function listReviews(req, res, next) {
  try {
    const projectId = req.params.projectId;
    await requireProjectAccess(req, projectId, 'Only the project owner or a super admin can list reviews');
    const reviews = await GitProjectService.listReviewRequests(projectId, {
      provider: requestedProvider(req),
    });
    send(res, reviews);
  } catch (error) {
    next(error);
  }
}

async function createReview(req, res, next) {
  try {
    const projectId = await projectForTicket(req.params.ticketId);
    await requireProjectAccess(req, projectId, 'Only the project owner or a super admin can create a review');
    const result = await GitProjectService.createReviewRequest(
      projectId,
      req.params.ticketId,
      req.body?.description,
      { provider: requestedProvider(req) }
    );
    send(res, result, 201);
  } catch (error) {
    next(error);
  }
}

async function getReviewDiff(req, res, next) {
  try {
    const projectId = await projectForTicket(req.params.ticketId);
    await requireProjectAccess(req, projectId, 'Only the project owner or a super admin can read a review diff');
    const diff = await GitProjectService.getReviewDiff(projectId, req.params.ticketId, {
      provider: requestedProvider(req),
    });
    send(res, diff);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listProviders,
  connectRepo,
  disconnectRepo,
  getRepoStatus,
  listRepos,
  getRepoForAgent,
  listBranches,
  createBranch,
  deleteBranch,
  listReviews,
  createReview,
  getReviewDiff,
};
