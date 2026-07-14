const { pool } = require('../db');
const TicketService = require('./TicketService');
const logger = require('../utils/logger');

class HeartbeatService {
  async recordHeartbeat(agentId, { ticketId, step, memory, cpu }) {
    const result = await pool.query(
      `INSERT INTO agent_heartbeats (agent_id, last_seen, current_ticket_id, current_step, memory_usage, cpu_usage, status)
       VALUES ($1, NOW(), $2, $3, $4::jsonb, $5::jsonb, 'online')
       ON CONFLICT (agent_id)
       DO UPDATE SET
         last_seen = NOW(),
         current_ticket_id = COALESCE($2, agent_heartbeats.current_ticket_id),
         current_step = COALESCE($3, agent_heartbeats.current_step),
         memory_usage = COALESCE($4::jsonb, agent_heartbeats.memory_usage),
         cpu_usage = COALESCE($5::jsonb, agent_heartbeats.cpu_usage),
         status = 'online'
       RETURNING *`,
      [agentId, ticketId || null, step || null, JSON.stringify(memory || {}), JSON.stringify(cpu || {})]
    );
    return result.rows[0];
  }

  async getAgentStatus(agentId) {
    const result = await pool.query(
      `SELECT
        a.id as agent_id,
        a.name as agent_name,
        a.owner_id,
        a.rate_limit,
        a.max_actions_per_day,
        ah.last_seen,
        ah.current_ticket_id,
        ah.current_step,
        ah.memory_usage,
        ah.cpu_usage,
        COALESCE(ah.status, 'offline') as status
      FROM agents a
      LEFT JOIN agent_heartbeats ah ON ah.agent_id = a.id
      WHERE a.id = $1`,
      [agentId]
    );
    return result.rows[0] || null;
  }

  async getAllAgents() {
    const result = await pool.query(
      `SELECT
        ah.agent_id,
        a.name,
        ah.status,
        ah.current_ticket_id,
        t.title as current_ticket_title,
        ah.last_seen,
        ah.current_step,
        COALESCE(COUNT(aa.id), 0) as actions_today,
        COALESCE(SUM(aa.cost_incurred), 0) as cost_today
      FROM agent_heartbeats ah
      LEFT JOIN agents a ON a.id = ah.agent_id
      LEFT JOIN tickets t ON t.id = ah.current_ticket_id
      LEFT JOIN agent_actions aa ON aa.agent_id = ah.agent_id AND aa.created_at >= CURRENT_DATE
      GROUP BY ah.agent_id, a.name, ah.status, ah.current_ticket_id, t.title, ah.last_seen, ah.current_step
      ORDER BY ah.last_seen DESC NULLS LAST`
    );
    return result.rows;
  }

  async cleanupStaleAgents() {
    const staleResult = await pool.query(
      `UPDATE agent_heartbeats
       SET status = 'offline'
       WHERE last_seen < NOW() - INTERVAL '60 seconds'
         AND status = 'online'
       RETURNING agent_id, current_ticket_id`
    );
    const staleAgents = staleResult.rows;

    for (const agent of staleAgents) {
      if (agent.current_ticket_id) {
        try {
          await TicketService.releaseTicket(agent.current_ticket_id);
        } catch (err) {
          logger.error(`Failed to release ticket ${agent.current_ticket_id} for stale agent ${agent.agent_id}:`, err.message);
        }
      }
    }

    return staleAgents.length;
  }
}

module.exports = new HeartbeatService();
