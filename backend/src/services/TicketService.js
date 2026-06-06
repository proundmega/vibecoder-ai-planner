const Ticket = require('../models/ticket');
const Project = require('../models/project');
const User = require('../models/user');

class TicketService {
  async create(projectId, title, description, priority, userId) {
    const project = await Project.findById(projectId);
    if (!project) throw new Error('Project not found');

    return await Ticket.create(projectId, title, description, priority, userId);
  }

  async findByProject(projectId, userId) {
    const project = await Project.findById(projectId);
    if (!project) throw new Error('Project not found');

    return await Ticket.findByProject(projectId, userId);
  }

  async findByStatus(projectId, status, userId) {
    return await Ticket.findByStatus(projectId, status);
  }

  async getOne(id, userId) {
    const ticket = await Ticket.findById(id);
    if (!ticket) throw new Error('Ticket not found');
    return ticket;
  }

  async update(id, data, userId) {
    const ticket = await Ticket.findById(id);
    if (!ticket) throw new Error('Ticket not found');

    const user = await User.find(userId);
    
    // Permission check: admins can edit any ticket, users can only edit their own
    if (
      user.role !== 'super_admin' &&
      user.role !== 'project_admin' &&
      user.role !== 'member' &&
      ticket.ownerId !== userId
    ) {
      throw new Error('Unauthorized to edit this ticket');
    }

    // Validate title not empty (if being updated)
    if (data.title !== undefined && data.title !== null && !data.title.trim()) {
      throw new Error('Title cannot be empty');
    }

    // Validate assignee is in same project (if changing assignee)
    if (data.assigneeId !== undefined && data.assigneeId !== null && data.assigneeId !== ticket.assigneeId) {
      const assignee = await User.find(data.assigneeId);
      if (!assignee) throw new Error('Assignee not found');
      
      const project = await Project.findById(ticket.projectId);
      if (!project) throw new Error('Project not found');
      
      const { pool } = require('../db');
      const projectMember = await pool.query(
        'SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2',
        [ticket.projectId, data.assigneeId]
      );
      if (projectMember.rows.length === 0) {
        throw new Error('Assignee is not a member of this project');
      }
    }

    return await Ticket.update(
      id,
      data.title,
      data.description,
      data.status,
      data.priority,
      data.assigneeId,
      userId
    );
  }

  async delete(id, userId) {
    const ticket = await Ticket.findById(id);
    if (!ticket) throw new Error('Ticket not found');

    const user = await User.find(userId);
    if (ticket.ownerId !== userId && !['project_admin', 'member', 'super_admin'].includes(user.role)) {
      throw new Error('Forbidden');
    }

    await Ticket.delete(id);
  }

  async claim(ticketId, userId) {
    const existingTicket = await Ticket.findById(ticketId);
    if (!existingTicket) throw new Error('Ticket not found');

    await Ticket.update(ticketId, null, null, null, null, userId, userId);
    return existingTicket;
  }

  async assign(ticketId, assigneeId, userId) {
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) throw new Error('Ticket not found');

    await Ticket.update(ticketId, null, null, null, null, assigneeId, userId);
    return ticket;
  }

  async updateStatus(ticketId, status, userId) {
    await Ticket.updateStatus(ticketId, status, userId);
  }

  async getComments(ticketId, userId) {
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) throw new Error('Ticket not found');
    return await Ticket.getComments(ticketId);
  }

  async addComment(ticketId, content, userId) {
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) throw new Error('Ticket not found');
    if (!content || !content.trim()) throw new Error('Comment content is required');
    return await Ticket.addComment(ticketId, content.trim(), userId);
  }

  static async getAgentTickets(agentId, projectId) {
    const { pool } = require('../db');
    // For non-user agents, get tickets in their owner's projects
    const result = await pool.query(
      `SELECT t.*, u.name as assignee_name, p.name as project_name 
       FROM tickets t 
       LEFT JOIN users u ON t.assignee_id = u.id 
       JOIN projects p ON t.project_id = p.id 
       WHERE p.owner_id = ANY(
         SELECT user_id FROM project_agents WHERE project_id = (
           SELECT id FROM projects WHERE owner_id = (
             SELECT id FROM agents WHERE id = $1
           )
         )
       ) AND t.project_id = $2
       ORDER BY t.created_at DESC`,
      [agentId, projectId]
    );
    return result.rows;
  }
}

module.exports = new TicketService();
