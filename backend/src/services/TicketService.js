const Ticket = require('../models/ticket');
const Project = require('../models/project');
const User = require('../models/user');
const { pool } = require('../db');
const PermissionService = require('../services/PermissionService');
const TicketPlanningService = require('../services/TicketPlanningService');
const TicketAttachmentService = require('../services/TicketAttachmentService');
const { ValidationError, NotFoundError, ForbiddenError } = require('../errors/HttpError');

class TicketService {
  async create(projectId, title, description, priority, userId) {
    const project = await Project.findById(projectId);
    if (!project) throw new NotFoundError('Project not found');

    return await Ticket.create(projectId, title, description, priority, userId);
  }

  async findByProject(projectId, userId) {
    const project = await Project.findById(projectId);
    if (!project) throw new NotFoundError('Project not found');

    return await Ticket.findByProject(projectId, userId);
  }

  async findByStatus(projectId, status, _userId) {
    return await Ticket.findByStatus(projectId, status);
  }

  async getOne(id, userId) {
    const ticket = await Ticket.findById(id);
    if (!ticket) throw new NotFoundError('Ticket not found');

    const planning = await TicketPlanningService.getPlanningForTicket(ticket, userId);
    const attachments = await TicketAttachmentService.list(ticket.id, userId);

    return {
      ...ticket,
      planning,
      attachments: attachments.map(a => ({
        id: a.id,
        filename: a.filename,
        contentType: a.content_type,
        sizeBytes: a.size_bytes,
        uploadedBy: a.uploaded_by_name || null,
        uploadedAt: a.created_at,
      })),
    };
  }

  async update(id, data, userId) {
    const ticket = await Ticket.findById(id);
    if (!ticket) throw new NotFoundError('Ticket not found');

    const user = await User.find(userId);
    
    // Permission check: roles with TICKET_UPDATE can edit, users can only edit their own
    const canUpdate = await PermissionService.hasPermission(user.role, 'TICKET_UPDATE');
    if (!canUpdate && ticket.ownerId !== userId) {
      throw new ForbiddenError('Unauthorized to edit this ticket');
    }

    // Validate title not empty (if being updated)
    if (data.title !== undefined && data.title !== null && !data.title.trim()) {
      throw new ValidationError('Title cannot be empty');
    }

    // Validate assignee is in same project (if changing assignee)
    if (data.assigneeId !== undefined && data.assigneeId !== null && data.assigneeId !== ticket.assigneeId) {
      const assignee = await User.find(data.assigneeId);
      if (!assignee) throw new NotFoundError('Assignee not found');
      
      const project = await Project.findById(ticket.projectId);
      if (!project) throw new NotFoundError('Project not found');
      
      
      const projectMember = await pool.query(
        'SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2',
        [ticket.projectId, data.assigneeId]
      );
      if (projectMember.rows.length === 0) {
        throw new ValidationError('Assignee is not a member of this project');
      }
    }

    // Validate milestone exists and belongs to same project (if changing)
    if (data.milestone_id !== undefined) {
      
      if (data.milestone_id !== null) {
        const milestoneCheck = await pool.query(
          'SELECT id FROM milestones WHERE id = $1 AND project_id = $2',
          [data.milestone_id, ticket.projectId]
        );
        if (milestoneCheck.rows.length === 0) {
          throw new NotFoundError('Milestone not found or does not belong to this project');
        }
      }
    }

    if (data.estimate !== undefined) {
      if (data.estimate !== null && (typeof data.estimate !== 'number' || data.estimate <= 0)) {
        throw new ValidationError('Estimate must be a positive integer');
      }
    }

    if (data.depends_on !== undefined) {
      if (data.depends_on !== null && Array.isArray(data.depends_on)) {
        const projectTickets = await Ticket.findByProject(ticket.projectId, userId);
        await this.hasCircularDependency(id, data.depends_on, projectTickets);
      }
    }

    return await Ticket.update(
      id,
      data.title !== undefined ? data.title : null,
      data.description !== undefined ? data.description : null,
      data.status !== undefined ? data.status : null,
      data.priority !== undefined ? data.priority : null,
      data.assigneeId !== undefined ? data.assigneeId : null,
      userId
    );
  }

  async updateMilestoneFields(id, { milestone_id, estimate, depends_on }, userId) {
    const ticket = await Ticket.findById(id);
    if (!ticket) throw new NotFoundError('Ticket not found');

    if (milestone_id !== undefined) {
      
      if (milestone_id !== null) {
        const milestoneCheck = await pool.query(
          'SELECT id FROM milestones WHERE id = $1 AND project_id = $2',
          [milestone_id, ticket.projectId]
        );
        if (milestoneCheck.rows.length === 0) {
          throw new NotFoundError('Milestone not found or does not belong to this project');
        }
      }
    }

    if (estimate !== undefined) {
      if (estimate !== null && (typeof estimate !== 'number' || estimate <= 0)) {
        throw new ValidationError('Estimate must be a positive integer');
      }
    }

    if (depends_on !== undefined) {
      if (depends_on !== null && Array.isArray(depends_on)) {
        const projectTickets = await Ticket.findByProject(ticket.projectId, userId);
        await this.hasCircularDependency(id, depends_on, projectTickets);
      }
    }

    
    const sets = [];
    const vals = [];
    let idx = 1;

    if (milestone_id !== undefined) {
      sets.push(`milestone_id=$${idx++}`);
      vals.push(milestone_id);
    }
    if (estimate !== undefined) {
      sets.push(`estimate=$${idx++}`);
      vals.push(estimate);
    }
    if (depends_on !== undefined) {
      sets.push(`depends_on=$${idx++}`);
      vals.push(depends_on);
    }

    if (sets.length === 0) {
      throw new ValidationError('No fields to update');
    }

    vals.push(id);
    const result = await pool.query(
      `UPDATE tickets SET ${sets.join(', ')} WHERE id=$${idx} RETURNING *`,
      vals
    );

    return result.rows[0];
  }

  async delete(id, userId) {
    const ticket = await Ticket.findById(id);
    if (!ticket) throw new NotFoundError('Ticket not found');

    const user = await User.find(userId);
    const canDelete = await PermissionService.hasPermission(user.role, 'TICKET_DELETE');
    if (!canDelete && ticket.ownerId !== userId) {
      throw new ForbiddenError('Forbidden');
    }

    await Ticket.delete(id);
  }

  async claim(ticketId, userId) {
    const existingTicket = await Ticket.findById(ticketId);
    if (!existingTicket) throw new NotFoundError('Ticket not found');

    await Ticket.update(ticketId, null, null, null, null, userId, userId);
    return existingTicket;
  }

  async assign(ticketId, assigneeId, userId) {
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) throw new NotFoundError('Ticket not found');

    await Ticket.update(ticketId, null, null, null, null, assigneeId, userId);
    return ticket;
  }

  async updateStatus(ticketId, status, userId) {
    await Ticket.updateStatus(ticketId, status, userId);
  }

  async getComments(ticketId, _userId) {
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) throw new NotFoundError('Ticket not found');
    return await Ticket.getComments(ticketId);
  }

  async addComment(ticketId, content, userId) {
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) throw new NotFoundError('Ticket not found');
    if (!content || !content.trim()) throw new ValidationError('Comment content is required');
    return await Ticket.addComment(ticketId, content.trim(), userId);
  }

  async getAgentTickets(agentId, projectId) {
    
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

  async pickUpTicket(ticketId, agentId) {
    

    const ticketResult = await pool.query(
      'SELECT * FROM tickets WHERE id = $1',
      [ticketId]
    );

    if (ticketResult.rows.length === 0) {
      throw new NotFoundError('Ticket not found');
    }

    const ticket = ticketResult.rows[0];

    if (ticket.status !== 'backlog') {
      throw new ValidationError('Only backlog tickets can be picked up');
    }

    if (ticket.assigned_agent_id) {
      throw new ValidationError('Ticket already assigned to another agent');
    }

    const result = await pool.query(
      `UPDATE tickets 
       SET assigned_agent_id = $1, locked_at = CURRENT_TIMESTAMP, status = 'in_progress'
       WHERE id = $2 AND status = 'backlog' AND assigned_agent_id IS NULL
       RETURNING *`,
      [agentId, ticketId]
    );

    if (result.rows.length === 0) {
      throw new ValidationError('Ticket was already picked up by another agent');
    }

    return result.rows[0];
  }

  async releaseTicket(ticketId, _adminId) {
    

    const ticketResult = await pool.query(
      'SELECT * FROM tickets WHERE id = $1',
      [ticketId]
    );

    if (ticketResult.rows.length === 0) {
      throw new NotFoundError('Ticket not found');
    }

    const ticket = ticketResult.rows[0];

    if (!ticket.assigned_agent_id) {
      throw new ValidationError('Ticket is not assigned to any agent');
    }

    const result = await pool.query(
      `UPDATE tickets 
       SET assigned_agent_id = NULL, locked_at = NULL, status = 'backlog'
       WHERE id = $1 RETURNING *`,
      [ticketId]
    );

    return result.rows[0];
  }

  async enforceOwnership(ticketId, userId) {
    

    const result = await pool.query(
      'SELECT assigned_agent_id FROM tickets WHERE id = $1',
      [ticketId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Ticket not found');
    }

    const ticket = result.rows[0];

    if (ticket.assigned_agent_id && ticket.assigned_agent_id !== userId) {
      throw new ForbiddenError(`Ticket is being worked on by agent ${ticket.assigned_agent_id}`);
    }

    return ticket;
  }

  async validateDependencies(ticketId) {
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) throw new NotFoundError('Ticket not found');
    if (!ticket.depends_on || ticket.depends_on.length === 0) return;

    
    const placeholders = ticket.depends_on.map((_, i) => `$${i + 2}`).join(', ');
    const deps = await pool.query(
      `SELECT id, title, status, phase FROM tickets WHERE id IN (${placeholders})`,
      [ticketId, ...ticket.depends_on]
    );

    const incomplete = deps.rows.filter(d =>
      d.status !== 'done' && d.phase !== 'done' && d.phase !== 'deployed'
    );
    if (incomplete.length > 0) {
      throw new ValidationError(
        `Cannot start: the following dependencies are not done: ${incomplete.map(d => d.title).join(', ')}`
      );
    }
  }

  async hasCircularDependency(ticketId, newDepIds, allProjectTickets) {
    const adjMap = new Map();
    for (const t of allProjectTickets) {
      adjMap.set(t.id.toString(), (t.depends_on || []).map(String));
    }
    adjMap.set(String(ticketId), (newDepIds || []).map(String));

    const visited = new Set();
    const recStack = new Set();

    function dfs(id) {
      if (recStack.has(id)) return true;
      if (visited.has(id)) return false;
      visited.add(id);
      recStack.add(id);
      const deps = adjMap.get(id) || [];
      for (const depId of deps) {
        if (dfs(depId)) return true;
      }
      recStack.delete(id);
      return false;
    }

    if (dfs(String(ticketId))) {
      throw new ValidationError('Circular dependency detected');
    }
  }

  async recoverOrphanedTickets(staleMinutes = 60) {
    

    if (typeof staleMinutes !== 'number' || staleMinutes <= 0) {
      throw new ValidationError('staleMinutes must be a positive number');
    }

    const result = await pool.query(
      `UPDATE tickets 
        SET assigned_agent_id = NULL, locked_at = NULL, status = 'backlog'
        WHERE status = 'in_progress' 
        AND locked_at < NOW() - make_interval(mins => $1)
        AND assigned_agent_id IS NOT NULL
        RETURNING id, title, assigned_agent_id, locked_at`,
      [staleMinutes]
    );

    return result.rows;
  }
}

module.exports = new TicketService();
