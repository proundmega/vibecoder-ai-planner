const { pool } = require('../db');
const { NotFoundError, ValidationError } = require('../errors/HttpError');

class PhaseService {
  static ALLOWED_TRANSITIONS = {
    draft: ['planning'],
    planning: ['plan_approved', 'draft'],
    plan_approved: ['assigned', 'planning'],
    assigned: ['in_progress', 'planning'],
    in_progress: ['review', 'blocked', 'backlog'],
    blocked: ['in_progress'],
    review: ['human_approval', 'in_progress', 'backlog'],
    human_approval: ['done', 'review'],
    done: ['deployed', 'in_progress'],
    deployed: ['done'],
  };

  static BACKLOG_COMPATIBLE_PHASES = ['draft', 'planning', 'plan_approved', 'assigned'];

  static async transition(ticketId, toPhase, actorType = 'system', actorId = null, metadata = null) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const ticketResult = await client.query(
        'SELECT * FROM tickets WHERE id = $1 AND deleted_at IS NULL',
        [ticketId]
      );

      if (ticketResult.rows.length === 0) {
        throw new NotFoundError('Ticket not found');
      }

      const ticket = ticketResult.rows[0];
      const currentPhase = ticket.phase || 'draft';

      const allowed = PhaseService.ALLOWED_TRANSITIONS[currentPhase] || [];
      if (!allowed.includes(toPhase)) {
        throw new ValidationError(
          `Cannot transition from '${currentPhase}' to '${toPhase}'. Allowed: ${allowed.join(', ')}`
        );
      }

      await client.query(
        'UPDATE tickets SET phase = $1, updated_at = NOW() WHERE id = $2',
        [toPhase, ticketId]
      );

      await client.query(
        `INSERT INTO ticket_phases (ticket_id, from_phase, to_phase, actor_type, actor_id, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [ticketId, currentPhase, toPhase, actorType, actorId, metadata ? JSON.stringify(metadata) : null]
      );

      await client.query('COMMIT');

      return { ticketId, fromPhase: currentPhase, toPhase };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async getAllowedNextPhases(ticketId) {
    const ticketResult = await pool.query(
      'SELECT phase FROM tickets WHERE id = $1 AND deleted_at IS NULL',
      [ticketId]
    );

    if (ticketResult.rows.length === 0) {
      throw new NotFoundError('Ticket not found');
    }

    const currentPhase = ticketResult.rows[0].phase || 'draft';
    return PhaseService.ALLOWED_TRANSITIONS[currentPhase] || [];
  }

  static async getCurrentPhase(ticketId) {
    const ticketResult = await pool.query(
      'SELECT phase FROM tickets WHERE id = $1 AND deleted_at IS NULL',
      [ticketId]
    );

    if (ticketResult.rows.length === 0) {
      throw new NotFoundError('Ticket not found');
    }

    return ticketResult.rows[0].phase || 'draft';
  }

  static async getPhaseHistory(ticketId) {
    const result = await pool.query(
      `SELECT from_phase, to_phase, actor_type, actor_id, metadata, created_at
       FROM ticket_phases
       WHERE ticket_id = $1
       ORDER BY created_at ASC`,
      [ticketId]
    );

    return result.rows;
  }

  static async getGateStatus(ticketId, phase) {
    const ticketResult = await pool.query(
      `SELECT t.planning_status, t.template_schema
       FROM tickets t
       WHERE t.id = $1 AND t.deleted_at IS NULL`,
      [ticketId]
    );

    if (ticketResult.rows.length === 0) {
      throw new NotFoundError('Ticket not found');
    }

    const ticket = ticketResult.rows[0];

    const gates = {
      planning_complete: ticket.planning_status === 'completed',
      plan_approved: ticket.planning_status === 'completed',
    };

    return {
      phase,
      gates,
      allPassed: Object.values(gates).every(Boolean),
      failedGates: Object.entries(gates).filter(([, passed]) => !passed).map(([name]) => name),
    };
  }

  static isBacklogCompatible(phase) {
    return PhaseService.BACKLOG_COMPATIBLE_PHASES.includes(phase);
  }
}

module.exports = new PhaseService();
