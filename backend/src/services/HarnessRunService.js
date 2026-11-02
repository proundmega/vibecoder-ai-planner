const { pool } = require('../db');
const { NotFoundError, ValidationError, ConflictError } = require('../errors/HttpError');

/**
 * Durable execution state for the coding harness (fg-33).
 *
 * A run is created before the agent touches Git/OpenCode and is updated through
 * checkpoints. A ticket lease guarantees at most one active run per ticket.
 * Every mutation is written before the next side effect so a crashed agent can
 * be recovered from the database instead of from memory.
 */

const RUN_STATUSES = Object.freeze([
  'running',
  'succeeded',
  'failed',
  'dead_letter',
  'budget_exceeded',
]);

const TERMINAL_RUN_STATUSES = Object.freeze(
  RUN_STATUSES.filter((status) => status !== 'running')
);

const HARNESS_STEPS = Object.freeze([
  'created',
  'cloned',
  'session_ready',
  'prompting',
  'verifying',
  'publishing',
  'done',
]);

const DEFAULT_LEASE_SECONDS = 600;
const MAX_LEASE_SECONDS = 86_400;

function positiveInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError(`${field} must be a positive integer`);
  }
  return parsed;
}

function requiredString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${field} is required`);
  }
  return value.trim();
}

function leaseSeconds(value) {
  if (value === undefined || value === null) return DEFAULT_LEASE_SECONDS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LEASE_SECONDS) {
    throw new ValidationError(`ttlSeconds must be an integer between 1 and ${MAX_LEASE_SECONDS}`);
  }
  return parsed;
}

function checkpointPayload(payload) {
  if (payload === undefined || payload === null) return '{}';
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ValidationError('payload must be a JSON object');
  }
  return JSON.stringify(payload);
}

class HarnessRunService {
  /**
   * Persist a new run. Must be called before the workspace is cloned.
   */
  async startRun({
    ticketId,
    agentId,
    branch,
    baseSha = null,
    workspacePath = null,
    sessionId = null,
    provider = null,
    model = null,
    attempt = 1,
  } = {}) {
    const normalisedTicketId = positiveInteger(ticketId, 'ticketId');
    const normalisedAgentId = positiveInteger(agentId, 'agentId');
    const normalisedBranch = requiredString(branch, 'branch');
    const normalisedAttempt = positiveInteger(attempt, 'attempt');

    const result = await pool.query(
      `INSERT INTO harness_runs
         (ticket_id, agent_id, branch, base_sha, workspace_path, session_id,
          provider, model, attempt)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        normalisedTicketId,
        normalisedAgentId,
        normalisedBranch,
        baseSha,
        workspacePath,
        sessionId,
        provider,
        model,
        normalisedAttempt,
      ]
    );

    return result.rows[0];
  }

  async getRun(runId) {
    const id = requiredString(runId, 'runId');
    const result = await pool.query('SELECT * FROM harness_runs WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      throw new NotFoundError('Harness run not found');
    }
    return result.rows[0];
  }

  async getLatestRunForTicket(ticketId) {
    const id = positiveInteger(ticketId, 'ticketId');
    const result = await pool.query(
      `SELECT * FROM harness_runs
       WHERE ticket_id = $1
       ORDER BY started_at DESC
       LIMIT 1`,
      [id]
    );
    return result.rows[0] || null;
  }

  async listActiveRunsForAgent(agentId) {
    const id = positiveInteger(agentId, 'agentId');
    const result = await pool.query(
      `SELECT * FROM harness_runs
       WHERE agent_id = $1 AND status = 'running'
       ORDER BY started_at ASC`,
      [id]
    );
    return result.rows;
  }

  async getCheckpoints(runId) {
    const id = requiredString(runId, 'runId');
    const result = await pool.query(
      `SELECT * FROM harness_checkpoints
       WHERE run_id = $1
       ORDER BY created_at ASC`,
      [id]
    );
    return result.rows;
  }

  /**
   * Record a completed step and update the run's current step in one statement.
   * A checkpoint is only written when the run is still active, so a late worker
   * cannot resurrect a finished run.
   */
  async recordCheckpoint(runId, step, payload = {}) {
    const id = requiredString(runId, 'runId');
    const normalisedStep = requiredString(step, 'step');
    const json = checkpointPayload(payload);

    const result = await pool.query(
      `WITH updated AS (
         UPDATE harness_runs
         SET step = $2, heartbeat_at = NOW()
         WHERE id = $1 AND status = 'running'
         RETURNING id
       )
       INSERT INTO harness_checkpoints (run_id, step, payload)
       SELECT id, $2, $3::jsonb FROM updated
       RETURNING *`,
      [id, normalisedStep, json]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Active harness run not found');
    }
    return result.rows[0];
  }

  async heartbeat(runId, agentId, step = null) {
    const id = requiredString(runId, 'runId');
    const normalisedAgentId = positiveInteger(agentId, 'agentId');
    const normalisedStep = step === null || step === undefined
      ? null
      : requiredString(step, 'step');

    const result = await pool.query(
      `UPDATE harness_runs
       SET heartbeat_at = NOW(), step = COALESCE($3, step)
       WHERE id = $1 AND agent_id = $2 AND status = 'running'
       RETURNING *`,
      [id, normalisedAgentId, normalisedStep]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Active harness run not found');
    }
    return result.rows[0];
  }

  /**
   * Finish a run and release its lease. Repeated finishes are idempotent and
   * return the already-terminal row, which makes crash recovery safe.
   */
  async finishRun(runId, { status, error = null, headSha = null, prUrl = null } = {}) {
    const id = requiredString(runId, 'runId');
    if (!TERMINAL_RUN_STATUSES.includes(status)) {
      throw new ValidationError(
        `status must be one of: ${TERMINAL_RUN_STATUSES.join(', ')}`
      );
    }

    const result = await pool.query(
      `WITH finished AS (
         UPDATE harness_runs
         SET status = $2,
             error = $3,
             head_sha = COALESCE($4, head_sha),
             pr_url = COALESCE($5, pr_url),
             heartbeat_at = NOW(),
             finished_at = NOW()
         WHERE id = $1 AND status = 'running'
         RETURNING *
       ),
       released AS (
         DELETE FROM harness_leases WHERE run_id = $1
       )
       SELECT * FROM finished`,
      [id, status, error, headSha, prUrl]
    );

    if (result.rows.length > 0) {
      return result.rows[0];
    }

    const existing = await this.getRun(id);
    if (TERMINAL_RUN_STATUSES.includes(existing.status)) {
      return existing;
    }
    throw new ConflictError('Harness run is not active');
  }

  /**
   * Claim or renew a ticket lease. Returns null when another run holds an
   * unexpired lease. A run may always re-claim its own lease.
   */
  async claimLease({ ticketId, runId, agentId, ttlSeconds } = {}) {
    const normalisedTicketId = positiveInteger(ticketId, 'ticketId');
    const normalisedRunId = requiredString(runId, 'runId');
    const normalisedAgentId = positiveInteger(agentId, 'agentId');
    const ttl = leaseSeconds(ttlSeconds);

    const result = await pool.query(
      `INSERT INTO harness_leases (ticket_id, run_id, agent_id, expires_at, updated_at)
       SELECT $1, $2, $3, NOW() + ($4::int * INTERVAL '1 second'), NOW()
       WHERE EXISTS (
         SELECT 1 FROM harness_runs
         WHERE id = $2 AND ticket_id = $1 AND agent_id = $3 AND status = 'running'
       )
       ON CONFLICT (ticket_id) DO UPDATE
       SET run_id = EXCLUDED.run_id,
           agent_id = EXCLUDED.agent_id,
           expires_at = EXCLUDED.expires_at,
           updated_at = NOW()
       WHERE harness_leases.expires_at < NOW()
          OR harness_leases.run_id = EXCLUDED.run_id
       RETURNING *`,
      [normalisedTicketId, normalisedRunId, normalisedAgentId, ttl]
    );

    return result.rows[0] || null;
  }

  async renewLease({ ticketId, runId, agentId, ttlSeconds } = {}) {
    const normalisedTicketId = positiveInteger(ticketId, 'ticketId');
    const normalisedRunId = requiredString(runId, 'runId');
    const normalisedAgentId = positiveInteger(agentId, 'agentId');
    const ttl = leaseSeconds(ttlSeconds);

    const result = await pool.query(
      `UPDATE harness_leases
       SET expires_at = NOW() + ($4::int * INTERVAL '1 second'),
           updated_at = NOW()
       WHERE ticket_id = $1
         AND run_id = $2
         AND agent_id = $3
         AND expires_at > NOW()
       RETURNING *`,
      [normalisedTicketId, normalisedRunId, normalisedAgentId, ttl]
    );

    return result.rows[0] || null;
  }

  async releaseLease(ticketId, runId) {
    const normalisedTicketId = positiveInteger(ticketId, 'ticketId');
    const normalisedRunId = requiredString(runId, 'runId');

    const result = await pool.query(
      `DELETE FROM harness_leases
       WHERE ticket_id = $1 AND run_id = $2
       RETURNING *`,
      [normalisedTicketId, normalisedRunId]
    );

    return result.rows.length > 0;
  }

  /**
   * Atomically expire stale leases and fail their runs. Safe to run from every
   * agent: expired rows are locked with SKIP LOCKED, so one reaper wins.
   *
   * Returns the reaped tickets so the caller can release them via
   * TicketService (releasing a ticket is a separate workflow concern).
   */
  async reapExpiredLeases(limit = 50) {
    const parsedLimit = Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000) {
      throw new ValidationError('limit must be an integer between 1 and 1000');
    }

    const result = await pool.query(
      `WITH expired AS (
         SELECT ticket_id, run_id
         FROM harness_leases
         WHERE expires_at < NOW()
         ORDER BY expires_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       ),
       deleted AS (
         DELETE FROM harness_leases l
         USING expired e
         WHERE l.ticket_id = e.ticket_id
         RETURNING l.ticket_id, l.run_id, l.agent_id
       ),
       failed AS (
         UPDATE harness_runs r
         SET status = 'failed',
             step = 'reaped',
             finished_at = NOW(),
             error = COALESCE(r.error, 'lease expired without heartbeat')
         FROM deleted d
         WHERE r.id = d.run_id AND r.status = 'running'
         RETURNING r.id, r.ticket_id, r.agent_id
       )
       SELECT d.ticket_id,
              d.run_id,
              d.agent_id,
              (f.id IS NOT NULL) AS run_failed
       FROM deleted d
       LEFT JOIN failed f ON f.id = d.run_id
       ORDER BY d.ticket_id`,
      [parsedLimit]
    );

    return result.rows;
  }
}

module.exports = new HarnessRunService();
module.exports.HarnessRunService = HarnessRunService;
module.exports.RUN_STATUSES = RUN_STATUSES;
module.exports.TERMINAL_RUN_STATUSES = TERMINAL_RUN_STATUSES;
module.exports.HARNESS_STEPS = HARNESS_STEPS;
module.exports.DEFAULT_LEASE_SECONDS = DEFAULT_LEASE_SECONDS;
module.exports.MAX_LEASE_SECONDS = MAX_LEASE_SECONDS;
