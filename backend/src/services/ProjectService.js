const Project = require('../models/project');
const UserService = require('./UserService');

class ProjectService {
  async list(userId) {
    const user = await UserService.findById(userId);
    if (!user) throw new Error('User not found');

    return await Project.findAll(userId);
  }

  async getOne(id, userId) {
    const project = await Project.findById(id);
    if (!project) throw new Error('Project not found');
    return project;
  }

  async create(name, description, userId) {
    const user = await UserService.findById(userId);
    if (!user) throw new Error('User not found');

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
    if (!project) throw new Error('Project not found');
    if (project.ownerId !== userId) throw new Error('Unauthorized');

    await Project.delete(id);
  }

  async updateMembership(id, userId, role, action) {
    await Project.share(id, userId);
    return { success: true };
  }
}

module.exports = new ProjectService();
