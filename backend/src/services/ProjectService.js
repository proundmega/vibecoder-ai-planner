const Project = require('../models/project');
const TicketService = require('../services/TicketService');
const { NotFoundError, ForbiddenError, ValidationError } = require('../errors/HttpError');

class ProjectService {
  async list(userId) {
    return await Project.findAll(userId);
  }

  async getOne(id, userId) {
    const project = await Project.findById(id);
    if (!project) throw new NotFoundError('Project not found');
    return project;
  }

  async create(name, description, userId) {
    return await Project.create(name, description, userId);
  }

  async update(id, data, userId) {
    const project = await Project.findById(id);
    if (!project) throw new Error('Project not found');
    if (project.ownerId !== userId) throw new Error('Unauthorized');

    return await Project.update(id, ...Object.values(data));
  }

  async delete(id, userId) {
    const project = await Project.findById(id);
    if (!project) throw new NotFoundError('Project not found');
    if (project.ownerId !== userId) throw new ForbiddenError('Unauthorized');

    const tickets = await TicketService.findByProject(id, userId);
    if (tickets.length > 0) {
      throw new ValidationError('Cannot delete project with existing tickets');
    }

    await Project.delete(id);
  }

  async updateMembership(id, userId, role, action) {
    await Project.share(id, userId);
    return { success: true };
  }

  async getMemberships(projectId) {
    const { pool } = require('../db');
    const result = await pool.query(
      `SELECT pm.*, u.name as user_name, u.email as user_email 
       FROM project_memberships pm 
       JOIN users u ON pm.user_id = u.id 
       WHERE pm.project_id = $1`,
      [projectId]
    );
    return result.rows;
  }
}

module.exports = new ProjectService();
