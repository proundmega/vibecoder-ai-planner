const ProjectService = require('../services/ProjectService');
const TicketService = require('../services/TicketService');
const { pool } = require('../db');

async function listProjects(req, res, next) {
  try {
    const projects = await ProjectService.list(req.user.userId);
    res.json({ success: true, data: projects });
  } catch (error) {
    next(error);
  }
}

async function createProject(req, res, next) {
  try {
    const { name, description } = req.body;
    const project = await ProjectService.create(name, description, req.user.userId);
    res.status(201).json({ success: true, data: project });
  } catch (error) {
    next(error);
  }
}

async function getProject(req, res, next) {
  try {
    const project = await ProjectService.getOne(req.params.id, req.user.userId);
    const tickets = await TicketService.findByProject(project.id, req.user.userId);
    
    res.json({
      success: true,
      data: {
        ...project,
        ticketCount: tickets.length,
        ticketIds: tickets.map(t => t.id)
      }
    });
  } catch (error) {
    next(error);
  }
}

async function updateProject(req, res, next) {
  try {
    const { name, description } = req.body;
    const project = await ProjectService.update(req.params.id, { name, description }, req.user.userId);
    res.json({ success: true, data: project });
  } catch (error) {
    next(error);
  }
}

async function deleteProject(req, res, next) {
  try {
    await ProjectService.delete(req.params.id, req.user.userId);
    res.json({ success: true, data: { message: 'Project deleted' } });
  } catch (error) {
    next(error);
  }
}

async function getProjectTickets(req, res, next) {
  try {
    const tickets = await TicketService.findByProject(req.params.id, req.user.userId);
    res.json({ success: true, data: tickets });
  } catch (error) {
    next(error);
  }
}

async function getProjectTicketsByStatus(req, res, next) {
  try {
    const tickets = await TicketService.findByStatus(
      req.params.id,
      req.params.status.toLowerCase(),
      req.user.userId
    );
    res.json({ success: true, data: tickets });
  } catch (error) {
    next(error);
  }
}

async function getProjectMemberships(req, res, next) {
  try {
    const memberships = await ProjectService.getMemberships(req.params.id);
    res.json({ success: true, data: memberships });
  } catch (error) {
    next(error);
  }
}

async function getProjectUsers(req, res, next) {
  try {
    await ProjectService.getOne(req.params.id, req.user.userId);
    
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.role 
       FROM users u 
       WHERE u.id != $1 
       ORDER BY u.name NULLS FIRST, u.email`,
      [req.user.userId]
    );
    
    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
}

async function createProjectTicket(req, res, next) {
  try {
    const { title, description, priority } = req.body;
    const ticket = await TicketService.create(req.params.id, title, description, priority, req.user.userId);
    res.status(201).json({ success: true, data: ticket });
  } catch (error) {
    next(error);
  }
}

async function updateProjectTicket(req, res, next) {
  try {
    const { title, description, status, priority, assigneeId } = req.body;
    await TicketService.update(req.params.ticketId, { title, description, status, priority, assigneeId }, req.user.userId);
    res.json({ success: true, data: { message: 'Ticket updated', status: req.body.status } });
  } catch (error) {
    next(error);
  }
}

async function deleteProjectTicket(req, res, next) {
  try {
    await TicketService.delete(req.params.ticketId, req.user.userId);
    res.json({ success: true, data: { message: 'Ticket deleted' } });
  } catch (error) {
    next(error);
  }
}

async function updateProjectTicketStatus(req, res, next) {
  try {
    const { status } = req.body;
    await TicketService.updateStatus(req.params.ticketId, status, req.user.userId);
    res.json({ success: true, data: { message: 'Ticket status updated', status } });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listProjects,
  createProject,
  getProject,
  updateProject,
  deleteProject,
  getProjectTickets,
  getProjectTicketsByStatus,
  getProjectMemberships,
  getProjectUsers,
  createProjectTicket,
  updateProjectTicket,
  deleteProjectTicket,
  updateProjectTicketStatus,
};
