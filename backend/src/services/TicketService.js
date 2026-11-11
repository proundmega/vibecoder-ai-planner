const Ticket = require('../models/ticket');
const Project = require('../models/project');
const User = require('../models/user');
const { pool } = require('../db');
const PermissionService = require('../services/PermissionService');
const TicketPlanningService = require('../services/TicketPlanningService');
const TicketAttachmentService = require('../services/TicketAttachmentService');
const DependencyService = require('../services/DependencyService');
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

    return DependencyService.enrich(await Ticket.findByProject(projectId, userId));
  }

  async findByStatus(projectId, status, _userId) {
    return DependencyService.enrich(await Ticket.findByStatus(projectId, status));
  }

  /**
   * Agent execution view: only dependency-ready backlog tickets.
   */
  async findBacklog(projectId) {
    const tickets = await Ticket.findByStatus(projectId, 'backlog');
    await DependencyService.enrich(tickets);
    return tickets.filter(ticket => ticket.ready !== false);
  }

  async getOne(id, userId) {
    const ticket = await Ticket.findById(id);
    if (!ticket) throw new NotFoundError('Ticket not found');

    await DependencyService.enrich([ticket]);

    const planning = await TicketPlanningService.getPlanningForTicket(ticket, userId);
    const attachments = await TicketAttachmentService.list(ticket.id, userId);

    // findById() selects the tickets row only, so resolve the assignee's
    // display name here for the ticket detail view.
    const assignee = ticket.assigneeId ? await User.find(ticket.assigneeId) : null;

    return {
      ...ticket,
      assigneeName: assignee?.name || null,
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

  /**
   * Normalize a legacy scalar actor (an agent id) into the explicit actor shape.
   */
  normalizeActor(actor) {
    if (actor && typeof actor === 'object') return actor;
    return { agentId: actor };
  }

  /**
   * Resolve the owning user and role for an API-key agent. The agent's own
   * request carries role='member' from the auth middleware, so the service
   * looks up the owner's real role for the admin bypass.
   */
  async resolveAgentActor({ agentId, operatorId, role }) {
    if (!agentId || role !== undefined) return { agentId, operatorId, role };

    const result = await pool.query(
      `SELECT a.owner_id, u.role
         FROM agents a
         LEFT JOIN users u ON u.id = a.owner_id
        WHERE a.id = $1`,
      [agentId]
    );
    const row = result.rows[0] || {};
    return { agentId, operatorId: operatorId || row.owner_id, role: row.role };
  }

  /**
   * bp-133 FR4: a ticket write requires project scope. Allowed actors are the
   * ticket owner, the project owner, an active project member, or an admin
   * bypass (project_admin/super_admin) — matching the existing permission
   * policy while closing the cross-project gap.
   */
  async canActOnTicketProject(ticket, actor = {}) {
    const role = actor.role || 'member';
    if (role === 'super_admin' || role === 'project_admin') return true;

    const userId = actor.operatorId ?? actor.userId;
    const ownerId = ticket.ownerId ?? ticket.owner_id;
    const projectId = ticket.projectId ?? ticket.project_id;

    if (userId && String(ownerId) === String(userId)) return true;

    const project = await Project.findById(projectId);
    if (!project) throw new NotFoundError('Project not found');
    if (userId && String(project.ownerId) === String(userId)) return true;
    if (!userId) return false;

    const membership = await pool.query(
      'SELECT 1 FROM project_memberships WHERE project_id = $1 AND user_id = $2',
      [projectId, userId]
    );
    return membership.rows.length > 0;
  }

  async update(id, data, userId, userRole) {
    const ticket = await Ticket.findById(id);
    if (!ticket) throw new NotFoundError('Ticket not found');

    const role = userRole || 'member';
    
    // Permission check: roles with TICKET_UPDATE can edit, users can only edit their own
    const canUpdate = await PermissionService.hasPermission(role, 'TICKET_UPDATE');
    if (!canUpdate && ticket.ownerId !== userId) {
      throw new ForbiddenError('Unauthorized to edit this ticket');
    }

    if (!(await this.canActOnTicketProject(ticket, { operatorId: userId, role }))) {
      throw new ForbiddenError('Unauthorized: not a member of this ticket\'s project');
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
      
      
      // The project owner is implicitly assignable even without a membership row.
      const isProjectOwner = String(project.ownerId) === String(data.assigneeId);
      if (!isProjectOwner) {
        const projectMember = await pool.query(
          'SELECT 1 FROM project_memberships WHERE project_id = $1 AND user_id = $2',
          [ticket.projectId, data.assigneeId]
        );
        if (projectMember.rows.length === 0) {
          throw new ValidationError('Assignee is not a member of this project');
        }
      }
    }

    // Canonical names are camelCase; snake_case is accepted for older internal callers.
    const milestoneId = data.milestoneId !== undefined ? data.milestoneId : data.milestone_id;
    const dependsOn = data.dependsOn !== undefined ? data.dependsOn : data.depends_on;

    // Validate milestone exists and belongs to same project (if changing)
    if (milestoneId !== undefined && milestoneId !== null) {
      const milestoneCheck = await pool.query(
        'SELECT id FROM milestones WHERE id = $1 AND project_id = $2',
        [milestoneId, ticket.projectId]
      );
      if (milestoneCheck.rows.length === 0) {
        throw new NotFoundError('Milestone not found or does not belong to this project');
      }
    }

    if (data.estimate !== undefined) {
      if (data.estimate !== null && (!Number.isInteger(data.estimate) || data.estimate <= 0)) {
        throw new ValidationError('Estimate must be a positive integer');
      }
    }

    if (dependsOn !== undefined && dependsOn !== null && Array.isArray(dependsOn)) {
      const projectTickets = await Ticket.findByProject(ticket.projectId, userId);
      await this.hasCircularDependency(id, dependsOn, projectTickets);
    }

    const updates = {
      title: data.title,
      description: data.description,
      status: data.status,
      priority: data.priority,
      assigneeId: data.assigneeId,
      prUrl: data.prUrl,
      milestoneId,
      estimate: data.estimate,
      dependsOn,
    };

    const entersExecution = data.status === 'in_progress' && ticket.status !== 'in_progress';
    if (!entersExecution) {
      // Single SQL round-trip; returns the persisted ticket.
      return await Ticket.update(id, updates);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query(
        'SELECT id FROM tickets WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [id]
      );
      if (locked.rows.length === 0) throw new NotFoundError('Ticket not found');

      await DependencyService.assertReady(id, { client, lock: true });
      const updated = await Ticket.update(id, updates, client);
      await client.query('COMMIT');
      return updated;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async delete(id, userId, userRole) {
    const ticket = await Ticket.findById(id);
    if (!ticket) throw new NotFoundError('Ticket not found');

    const role = userRole || 'member';
    const canDelete = await PermissionService.hasPermission(role, 'TICKET_DELETE');
    if (!canDelete && ticket.ownerId !== userId) {
      throw new ForbiddenError('Forbidden');
    }

    if (!(await this.canActOnTicketProject(ticket, { operatorId: userId, role }))) {
      throw new ForbiddenError('Unauthorized: not a member of this ticket\'s project');
    }

    await Ticket.delete(id);
  }

  async updateStatus(ticketId, status, userId) {
    if (status !== 'in_progress') {
      return await Ticket.updateStatus(ticketId, status, userId);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query(
        'SELECT id FROM tickets WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [ticketId]
      );
      if (locked.rows.length === 0) throw new NotFoundError('Ticket not found');

      await DependencyService.assertReady(ticketId, { client, lock: true });
      await Ticket.updateStatus(ticketId, status, userId, client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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

  async pickUpTicket(ticketId, actor) {
    const normalizedActor = await this.resolveAgentActor(this.normalizeActor(actor));
    const { agentId } = normalizedActor;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ticketResult = await client.query(
        'SELECT * FROM tickets WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [ticketId]
      );

      if (ticketResult.rows.length === 0) {
        throw new NotFoundError('Ticket not found');
      }

      const ticket = ticketResult.rows[0];

      if (!(await this.canActOnTicketProject(ticket, normalizedActor))) {
        throw new ForbiddenError('Unauthorized: not a member of this ticket\'s project');
      }

      if (ticket.status !== 'backlog') {
        throw new ValidationError('Only backlog tickets can be picked up');
      }

      if (ticket.assigned_agent_id) {
        throw new ValidationError('Ticket already assigned to another agent');
      }

      await DependencyService.assertReady(ticketId, { client, lock: true });

      const result = await client.query(
        `UPDATE tickets
         SET assigned_agent_id = $1, locked_at = CURRENT_TIMESTAMP, status = 'in_progress'
         WHERE id = $2 AND status = 'backlog' AND assigned_agent_id IS NULL
         RETURNING *`,
        [agentId, ticketId]
      );

      if (result.rows.length === 0) {
        throw new ValidationError('Ticket was already picked up by another agent');
      }

      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async releaseTicket(ticketId, { agentId = null, operatorId = null, role = null } = {}) {
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

    if (agentId !== null) {
      // The assigned agent may always release its own ticket, even if its
      // owner's membership changed after pickup.
      if (String(ticket.assigned_agent_id) !== String(agentId)) {
        throw new ForbiddenError('Ticket is assigned to another agent');
      }
    } else {
      if (!operatorId) {
        throw new ForbiddenError('Operator identity required to release a ticket');
      }
      if (!(await this.canActOnTicketProject(ticket, { operatorId, role }))) {
        throw new ForbiddenError('Unauthorized: not a member of this ticket\'s project');
      }
    }

    const result = await pool.query(
      `UPDATE tickets 
       SET assigned_agent_id = NULL, locked_at = NULL, status = 'backlog'
       WHERE id = $1 RETURNING *`,
      [ticketId]
    );

    return result.rows[0];
  }

  async enforceOwnership(ticketId, agentId) {
    

    const result = await pool.query(
      'SELECT assigned_agent_id FROM tickets WHERE id = $1',
      [ticketId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Ticket not found');
    }

    const ticket = result.rows[0];

    if (ticket.assigned_agent_id && String(ticket.assigned_agent_id) !== String(agentId)) {
      throw new ForbiddenError(`Ticket is being worked on by agent ${ticket.assigned_agent_id}`);
    }

    return ticket;
  }

  async validateDependencies(ticketId) {
    return DependencyService.assertReady(ticketId);
  }

  async hasCircularDependency(ticketId, newDepIds, allProjectTickets) {
    const adjMap = new Map();
    for (const t of allProjectTickets) {
      adjMap.set(t.id.toString(), (t.dependsOn || []).map(String));
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
