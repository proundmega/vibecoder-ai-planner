const Ticket = require('../models/ticket');
const Project = require('../models/project');

class TicketService {
  async create(projectId, title, description, userId) {
    const project = await Project.findById(projectId);
    if (!project) throw new Error('Project not found');

    return await Ticket.create(projectId, title, description, userId);
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

    const { title, description, status, priority, assigneeId } = data;
    
    return await Ticket.update(
      id,
      title,
      description,
      status,
      priority,
      assigneeId,
      userId
    );
  }

  async delete(id, userId) {
    const ticket = await Ticket.findById(id);
    if (!ticket) throw new Error('Ticket not found');

    await Ticket.delete(id);
  }

  async claim(ticketId, userId) {
    const existingTicket = await Ticket.findById(ticketId);
    if (!existingTicket) throw new Error('Ticket not found');

    await Ticket.update(ticketId, { assigneeId: userId }, userId);
    return existingTicket;
  }

  async assign(ticketId, assigneeId, userId) {
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) throw new Error('Ticket not found');

    await Ticket.update(ticketId, { assigneeId }, userId);
    return ticket;
  }

  async updateStatus(ticketId, status, userId) {
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) throw new Error('Ticket not found');

    const allowed = ['backlog', 'in_progress', 'review', 'done'];
    if (!allowed.includes(status)) {
      throw new Error('Invalid status');
    }

    return await Ticket.updateStatus(ticketId, status, userId);
  }

  static async getAgentTickets(agentId, projectId) {
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
