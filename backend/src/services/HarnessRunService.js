const { pool } = require('../db');
const {
  NotFoundError,
  ValidationError,
  ConflictError,
  ForbiddenError,
} = require('../errors/HttpError');

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
const DEFAULT_ORPHAN_AFTER_SECONDS = 900;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function positiveInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError(`${field} must be a positive integer`);
  }
  return parsed;
}

function requiredUuid(value, field) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new ValidationError(`${field} must be a UUID`);
  }
  return value;
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

function harnessStep(value, field = 'step') {
  if (!HARNESS_STEPS.includes(value)) {
    throw new ValidationError(`${field} must be one of: ${HARNESS_STEPS.join(', ')}`);
  }
  return value;
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

    let result;
    try {
      result = await pool.query(
        `INSERT INTO harness_runs
           (ticket_id, agent_id, branch, base_sha, workspace_path, session_id,
            provider, model, attempt)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9
         FROM tickets t
         JOIN agents a ON a.id = $2
         WHERE t.id = $1
           AND t.status = 'in_progress'
           AND t.assigned_agent_id = a.id
           AND NULLIF(BTRIM(t.pr_url), '') IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM harness_runs existing
             WHERE existing.ticket_id = t.id
               AND (
                 NULLIF(BTRIM(existing.pr_url), '') IS NOT NULL
                 OR NULLIF(BTRIM(existing.head_sha), '') IS NOT NULL
               )
           )
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
    } catch (error) {
      // The partial unique index on (ticket_id) WHERE status='running' is the
      // database backstop for the lease.
      if (error.code === '23505') {
        throw new ConflictError('Ticket already has an active harness run');
      }
      throw error;
    }

    if (result.rows.length === 0) {
      // Explain the refusal instead of always blaming assignment: a published
      // ticket (or one whose earlier run has publish evidence) must be reset by
      // an operator before it can be run again.
      const context = await pool.query(
        `SELECT t.status,
                NULLIF(BTRIM(t.pr_url), '') AS pr_url,
                t.assigned_agent_id,
                a.id AS agent_id,
                EXISTS (
                  SELECT 1 FROM harness_runs existing
                  WHERE existing.ticket_id = t.id
                    AND (
                      NULLIF(BTRIM(existing.pr_url), '') IS NOT NULL
                      OR NULLIF(BTRIM(existing.head_sha), '') IS NOT NULL
                    )
                ) AS has_publish_evidence
         FROM tickets t
         LEFT JOIN agents a ON a.id = $2
         WHERE t.id = $1`,
        [normalisedTicketId, normalisedAgentId]
      );
      const ticket = context.rows[0];
      if (!ticket) {
        throw new ForbiddenError('Ticket is not assigned to this agent');
      }
      if (ticket.pr_url || ticket.has_publish_evidence) {
        throw new ConflictError(
          'Ticket already has published work; an operator must reset the PR before a new run'
        );
      }
      if (
        ticket.status !== 'in_progress' ||
        String(ticket.assigned_agent_id) !== String(ticket.agent_id)
      ) {
        throw new ForbiddenError('Ticket is not assigned to this agent or is not in progress');
      }
      throw new ForbiddenError('Ticket is not assigned to this agent');
    }

    return result.rows[0];
  }

  async getRun(runId) {
    const id = requiredUuid(runId, 'runId');
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

  /**
   * Active runs owned by an agent, including the latest checkpoint payload so
   * startup recovery can see durable publish evidence (head sha / PR URL).
   */
  async listActiveRunsForAgent(agentId) {
    const id = positiveInteger(agentId, 'agentId');
    const result = await pool.query(
      `SELECT r.*,
              t.status AS ticket_status,
              t.pr_url AS ticket_pr_url,
              l.expires_at AS lease_expires_at,
              c.step AS last_checkpoint_step,
              c.payload AS last_checkpoint_payload
       FROM harness_runs r
       JOIN tickets t ON t.id = r.ticket_id
       LEFT JOIN harness_leases l ON l.run_id = r.id
       LEFT JOIN LATERAL (
         SELECT step, payload
         FROM harness_checkpoints
         WHERE run_id = r.id
         ORDER BY created_at DESC, id DESC
         LIMIT 1
       ) c ON TRUE
       WHERE r.agent_id = $1 AND r.status = 'running'
       ORDER BY r.started_at ASC`,
      [id]
    );
    return result.rows;
  }

  async getCheckpoints(runId) {
    const id = requiredUuid(runId, 'runId');
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
   * Steps may only move forward; a late worker cannot resurrect a finished run
   * or move the state machine backwards. Checkpoints for cloned/session_ready
   * also fill the run's workspace/session/base columns; publishing/done
   * checkpoints persist head sha and PR URL as run-level evidence.
   */
  async recordCheckpoint(runId, step, payload = {}) {
    const id = requiredUuid(runId, 'runId');
    const normalisedStep = harnessStep(requiredString(step, 'step'));
    const json = checkpointPayload(payload);

    const result = await pool.query(
      `WITH updated AS (
         UPDATE harness_runs
         SET step = $2,
             heartbeat_at = NOW(),
             workspace_path = COALESCE(($3::jsonb)->>'workspacePath', workspace_path),
             session_id = COALESCE(($3::jsonb)->>'sessionId', session_id),
             base_sha = COALESCE(($3::jsonb)->>'baseSha', base_sha),
             head_sha = COALESCE(
               NULLIF(BTRIM(($3::jsonb)->>'headSha'), ''), head_sha),
             pr_url = COALESCE(
               NULLIF(BTRIM(($3::jsonb)->>'prUrl'), ''), pr_url)
         WHERE id = $1
           AND status = 'running'
           AND COALESCE(array_position($4::text[], step), 0)
               <= array_position($4::text[], $2)
         RETURNING id
       )
       INSERT INTO harness_checkpoints (run_id, step, payload)
       SELECT id, $2, $3::jsonb FROM updated
       RETURNING *`,
      [id, normalisedStep, json, HARNESS_STEPS]
    );

    if (result.rows.length === 0) {
      const run = await this.getRun(id);
      if (run.status !== 'running') {
        throw new NotFoundError('Active harness run not found');
      }
      throw new ConflictError(
        `Checkpoint '${normalisedStep}' would move the run backwards`
      );
    }
    return result.rows[0];
  }

  async heartbeat(runId, agentId, agentStep = null) {
    const id = requiredUuid(runId, 'runId');
    const normalisedAgentId = positiveInteger(agentId, 'agentId');
    const normalisedAgentStep = agentStep === null || agentStep === undefined
      ? null
      : requiredString(agentStep, 'agentStep');

    const result = await pool.query(
      `UPDATE harness_runs
       SET heartbeat_at = NOW(), agent_step = COALESCE($3, agent_step)
       WHERE id = $1 AND agent_id = $2 AND status = 'running'
       RETURNING *`,
      [id, normalisedAgentId, normalisedAgentStep]
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
    const id = requiredUuid(runId, 'runId');
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
             head_sha = COALESCE(NULLIF(BTRIM($4), ''), head_sha),
             pr_url = COALESCE(NULLIF(BTRIM($5), ''), pr_url),
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
   * Persist publish evidence while the run is still active. Writing the head
   * sha immediately after the push and the PR URL immediately after creation
   * lets startup recovery adopt a publish whose finish call was lost.
   */
  async recordPublish(runId, agentId, { headSha = null, prUrl = null } = {}) {
    const id = requiredUuid(runId, 'runId');
    const normalisedAgentId = positiveInteger(agentId, 'agentId');
    const normalisedHeadSha = headSha === null || headSha === undefined
      ? null
      : requiredString(headSha, 'headSha');
    const normalisedPrUrl = prUrl === null || prUrl === undefined
      ? null
      : requiredString(prUrl, 'prUrl');

    if (normalisedHeadSha === null && normalisedPrUrl === null) {
      throw new ValidationError('headSha or prUrl is required');
    }

    const result = await pool.query(
      `UPDATE harness_runs
       SET head_sha = COALESCE($3, head_sha),
           pr_url = COALESCE($4, pr_url),
           heartbeat_at = NOW()
       WHERE id = $1 AND agent_id = $2 AND status = 'running'
       RETURNING *`,
      [id, normalisedAgentId, normalisedHeadSha, normalisedPrUrl]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Active harness run not found');
    }
    return result.rows[0];
  }

  /**
   * Explicitly return a ticket to backlog after its run failed or was
   * dead-lettered, but only when it is safe: the run is terminal **and recorded
   * no PR URL or head sha**, no other run for the ticket has publish evidence,
   * the ticket is still in_progress and it has no PR. Automatic reconciliation
   * only calls this for failed runs; dead_letter runs require an explicit
   * operator release. This guard stops a published run from resetting a
   * reviewed ticket.
   */
  async releaseTicketForRun(runId, { agentId = null } = {}) {
    const id = requiredUuid(runId, 'runId');
    const normalisedAgentId = agentId === null || agentId === undefined
      ? null
      : positiveInteger(agentId, 'agentId');

    const result = await pool.query(
      `WITH run AS (
         SELECT r.id, r.ticket_id, r.agent_id
         FROM harness_runs r
         WHERE r.id = $1
           AND r.status IN ('failed', 'dead_letter')
           AND NULLIF(BTRIM(r.pr_url), '') IS NULL
           AND NULLIF(BTRIM(r.head_sha), '') IS NULL
           AND ($2::bigint IS NULL OR r.agent_id = $2)
           AND NOT EXISTS (
             SELECT 1 FROM harness_runs other
             WHERE other.ticket_id = r.ticket_id
               AND other.id <> r.id
               AND (
                 NULLIF(BTRIM(other.pr_url), '') IS NOT NULL
                 OR NULLIF(BTRIM(other.head_sha), '') IS NOT NULL
               )
           )
       )
       UPDATE tickets t
       SET assigned_agent_id = NULL,
           locked_at = NULL,
           status = 'backlog'
       FROM run
       WHERE t.id = run.ticket_id
         AND t.status = 'in_progress'
         AND t.assigned_agent_id = run.agent_id
         AND NULLIF(BTRIM(t.pr_url), '') IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM harness_runs other
           WHERE other.ticket_id = run.ticket_id AND other.status = 'running'
         )
       RETURNING t.*`,
      [id, normalisedAgentId]
    );

    return result.rows[0] || null;
  }

  /**
   * Reconcile one terminal run with its ticket.
   *
   * Adopting a published run and releasing a failed run are deliberately
   * separate from finishing the run: the reaper may die between those steps.
   * Only a run whose `reconciled_at` is still NULL can change a ticket, so
   * repeated or concurrent calls cannot re-apply an old state. The `marked`
   * CTE is the concurrency gate: ticket CTEs depend on it, and only the
   * statement that flips the marker can proceed.
   *
   * Only the latest run for a ticket may touch it. Older runs are marked
   * reconciled (and promoted to succeeded when they recorded a PR) but never
   * release a ticket for a newer run or overwrite a newer ticket PR.
   *
   * - A run with a stored PR URL is adopted: a missing ticket PR is filled,
   *   an existing different PR is kept, and in_progress/backlog tickets move
   *   to review. Done tickets are never changed.
   * - A failed run with no PR or head evidence releases the ticket only when it
   *   is in_progress with no PR and no newer run exists.
   * - A dead_letter run is a manual-recovery state: it is never auto-released,
   *   so the ticket stays in_progress and needs_operator is reported.
   */
  async reconcileRun(runId) {
    const id = requiredUuid(runId, 'runId');

    const result = await pool.query(
      `WITH run AS (
         SELECT r.id,
                r.ticket_id,
                r.started_at,
                r.status,
                NULLIF(BTRIM(r.pr_url), '') AS pr_url,
                NULLIF(BTRIM(r.head_sha), '') AS head_sha,
                t.status AS ticket_status,
                NOT EXISTS (
                  SELECT 1
                  FROM harness_runs newer
                  WHERE newer.ticket_id = r.ticket_id
                    AND newer.id <> r.id
                    AND (newer.started_at, newer.id) > (r.started_at, r.id)
                ) AS is_latest
         FROM harness_runs r
         JOIN tickets t ON t.id = r.ticket_id
         WHERE r.id = $1 AND r.status <> 'running'
       ),
       marked AS (
         UPDATE harness_runs
         SET reconciled_at = NOW(),
             status = CASE
               WHEN status IN ('failed', 'dead_letter')
                 AND NULLIF(BTRIM(pr_url), '') IS NOT NULL
               THEN 'succeeded'
               ELSE status
             END,
             finished_at = CASE
               WHEN status IN ('failed', 'dead_letter')
                 AND NULLIF(BTRIM(pr_url), '') IS NOT NULL
               THEN COALESCE(finished_at, NOW())
               ELSE finished_at
             END
         WHERE id = $1
           AND status <> 'running'
           AND reconciled_at IS NULL
         RETURNING id
       ),
       superseded AS (
         UPDATE harness_runs old
         SET reconciled_at = NOW(),
             status = CASE
               WHEN old.status IN ('failed', 'dead_letter')
                 AND NULLIF(BTRIM(old.pr_url), '') IS NOT NULL
               THEN 'succeeded'
               ELSE old.status
             END,
             finished_at = CASE
               WHEN old.status IN ('failed', 'dead_letter')
                 AND NULLIF(BTRIM(old.pr_url), '') IS NOT NULL
               THEN COALESCE(old.finished_at, NOW())
               ELSE old.finished_at
             END
         FROM run, marked
         WHERE marked.id = run.id
           AND old.ticket_id = run.ticket_id
           AND old.id <> run.id
           AND old.status <> 'running'
           AND old.reconciled_at IS NULL
           AND (old.started_at, old.id) < (run.started_at, run.id)
         RETURNING old.id
       ),
       adopted AS (
         UPDATE tickets t
         SET pr_url = CASE
               WHEN NULLIF(BTRIM(t.pr_url), '') IS NULL THEN run.pr_url
               ELSE t.pr_url
             END,
             status = CASE
               WHEN t.status IN ('in_progress', 'backlog') THEN 'review'
               ELSE t.status
             END
         FROM run, marked
         WHERE marked.id = run.id
           AND run.is_latest
           AND run.pr_url IS NOT NULL
           AND t.id = run.ticket_id
           AND t.status <> 'done'
           AND NOT EXISTS (
             SELECT 1 FROM harness_runs other
             WHERE other.ticket_id = run.ticket_id
               AND other.status = 'running'
           )
         RETURNING t.id
       ),
       released AS (
         UPDATE tickets t
         SET assigned_agent_id = NULL,
             locked_at = NULL,
             status = 'backlog'
         FROM run, marked
         WHERE marked.id = run.id
           AND run.is_latest
           AND run.status = 'failed'
           AND run.pr_url IS NULL
           AND run.head_sha IS NULL
           AND t.id = run.ticket_id
           AND t.status = 'in_progress'
           AND NULLIF(BTRIM(t.pr_url), '') IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM harness_runs other
             WHERE other.ticket_id = run.ticket_id
               AND other.id <> run.id
               AND (
                 NULLIF(BTRIM(other.pr_url), '') IS NOT NULL
                 OR NULLIF(BTRIM(other.head_sha), '') IS NOT NULL
               )
           )
           AND NOT EXISTS (
             SELECT 1 FROM harness_runs other
             WHERE other.ticket_id = run.ticket_id
               AND other.status = 'running'
           )
         RETURNING t.id
       )
       SELECT run.id AS run_id,
              run.ticket_id,
              (marked.id IS NOT NULL) AS marked,
              (
                marked.id IS NOT NULL
                AND run.pr_url IS NOT NULL
                AND run.status IN ('failed', 'dead_letter')
              ) AS promoted,
              (adopted.id IS NOT NULL) AS adopted,
              (released.id IS NOT NULL) AS released,
              (
                marked.id IS NOT NULL
                AND run.is_latest
                AND run.ticket_status = 'in_progress'
                AND adopted.id IS NULL
                AND released.id IS NULL
              ) AS needs_operator
       FROM run
       LEFT JOIN marked ON TRUE
       LEFT JOIN adopted ON TRUE
       LEFT JOIN released ON TRUE`,
      [id]
    );

    return result.rows[0] || null;
  }

  /**
   * Workspace paths that cleanup must not touch: running runs and any run with
   * an unexpired lease. The agent uses this before pruning local clone dirs.
   */
  async listActiveWorkspacePaths(agentId) {
    const id = positiveInteger(agentId, 'agentId');

    // Fail closed: a running/leased run without a recorded path may have a
    // workspace we cannot protect, so cleanup must skip entirely.
    const incomplete = await pool.query(
      `SELECT 1
       FROM harness_runs r
       LEFT JOIN harness_leases l
         ON l.run_id = r.id AND l.expires_at > NOW()
       WHERE r.agent_id = $1
         AND (r.status = 'running' OR l.run_id IS NOT NULL)
         AND NULLIF(BTRIM(r.workspace_path), '') IS NULL
       LIMIT 1`,
      [id]
    );
    if (incomplete.rows.length > 0) {
      throw new ConflictError(
        'Active harness run has no recorded workspace path; refusing cleanup');
    }

    const result = await pool.query(
      `SELECT DISTINCT r.workspace_path
       FROM harness_runs r
       LEFT JOIN harness_leases l
         ON l.run_id = r.id AND l.expires_at > NOW()
       WHERE r.agent_id = $1
         AND NULLIF(BTRIM(r.workspace_path), '') IS NOT NULL
         AND (r.status = 'running' OR l.run_id IS NOT NULL)
       ORDER BY r.workspace_path`,
      [id]
    );
    return result.rows.map((row) => row.workspace_path);
  }

  /**
   * The newest pending terminal run per ticket. Sweeping this list makes the
   * reaper crash-safe: `reconciled_at` is only set after the ticket update, and
   * older runs are marked as superseded when the newest one is reconciled.
   * Reconciliation itself performs the concurrency check, so this query does
   * not rely on row locks that would end with the autocommit statement.
   */
  async listTerminalRunsForReconcile(limit = 50) {
    const parsedLimit = Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000) {
      throw new ValidationError('limit must be an integer between 1 and 1000');
    }

    const result = await pool.query(
      `SELECT DISTINCT ON (ticket_id) id
       FROM harness_runs
       WHERE status <> 'running' AND reconciled_at IS NULL
       ORDER BY ticket_id, started_at DESC, id DESC
       LIMIT $1`,
      [parsedLimit]
    );
    return result.rows.map((row) => row.id);
  }

  /**
   * Operator action: stop a run and hand its ticket to reconciliation.
   * A running run loses its lease immediately; the next sweep either adopts
   * publish evidence or releases the ticket through the normal guard.
   */
  async deadLetterRun(runId, { error = null } = {}) {
    const id = requiredUuid(runId, 'runId');
    const reason = error === null || error === undefined
      ? 'dead-lettered by operator'
      : requiredString(error, 'error');

    const result = await pool.query(
      `WITH updated AS (
         UPDATE harness_runs
         SET status = 'dead_letter',
             error = $2,
             finished_at = COALESCE(finished_at, NOW()),
             reconciled_at = NULL
         WHERE id = $1
           AND (
             status <> 'succeeded'
             OR (
               NULLIF(BTRIM(pr_url), '') IS NULL
               AND NULLIF(BTRIM(head_sha), '') IS NULL
             )
           )
         RETURNING *
       ),
       deleted AS (
         DELETE FROM harness_leases WHERE run_id = $1
       )
       SELECT * FROM updated`,
      [id, reason]
    );

    if (result.rows.length === 0) {
      const existing = await this.getRun(id);
      if (existing.status === 'succeeded') {
        throw new ConflictError(
          'Cannot dead-letter a succeeded harness run with publish evidence');
      }
      return existing;
    }
    return result.rows[0];
  }

  /**
   * Operator action: explicitly adopt a terminal run that recorded a PR.
   * Reuses the same latest-run/ticket guards as the reaper.
   */
  async adoptPublishedRun(runId, { prUrl = null } = {}) {
    const run = await this.getRun(runId);
    if (run.status === 'running') {
      throw new ConflictError('Harness run is still active');
    }

    const operatorPrUrl = prUrl === null || prUrl === undefined
      ? null
      : requiredString(prUrl, 'prUrl');
    const runPrUrl = run.pr_url && String(run.pr_url).trim() !== ''
      ? String(run.pr_url).trim()
      : null;
    if (operatorPrUrl && runPrUrl && operatorPrUrl !== runPrUrl) {
      throw new ConflictError(
        'Run already has a different PR URL; refusing to overwrite it');
    }

    const evidence = operatorPrUrl || runPrUrl;

    if (!evidence) {
      if (run.head_sha && String(run.head_sha).trim() !== '') {
        throw new ValidationError(
          'Run has a head sha but no PR URL; provide the operator-verified prUrl');
      }
      throw new ValidationError('Harness run has no publish evidence to adopt');
    }

    // Persist/confirm the evidence and make the run reconcilable again. An
    // operator may be recovering a run that a sweep marked reconciled without
    // adopting. The normal latest-run/ticket-PR guards still prevent regressions.
    await pool.query(
      `UPDATE harness_runs
       SET pr_url = COALESCE($2, pr_url), reconciled_at = NULL
       WHERE id = $1 AND status <> 'running'`,
      [runId, evidence]
    );

    return this.reconcileRun(runId);
  }

  /**
   * Claim or renew a ticket lease. Returns null when another run holds an
   * unexpired lease. A run may always re-claim its own lease.
   */
  async claimLease({ ticketId, runId, agentId, ttlSeconds } = {}) {
    const normalisedTicketId = positiveInteger(ticketId, 'ticketId');
    const normalisedRunId = requiredUuid(runId, 'runId');
    const normalisedAgentId = positiveInteger(agentId, 'agentId');
    const ttl = leaseSeconds(ttlSeconds);

    const result = await pool.query(
      `INSERT INTO harness_leases (ticket_id, run_id, agent_id, expires_at, updated_at)
       SELECT $1, $2, $3, NOW() + ($4::int * INTERVAL '1 second'), NOW()
       WHERE EXISTS (
         SELECT 1
         FROM harness_runs r
         JOIN tickets t ON t.id = r.ticket_id
         JOIN agents a ON a.id = r.agent_id
         WHERE r.id = $2
           AND r.ticket_id = $1
           AND r.agent_id = $3
           AND r.status = 'running'
           AND t.status = 'in_progress'
           AND t.assigned_agent_id = a.id
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
    const normalisedRunId = requiredUuid(runId, 'runId');
    const normalisedAgentId = positiveInteger(agentId, 'agentId');
    const ttl = leaseSeconds(ttlSeconds);

    const result = await pool.query(
      `UPDATE harness_leases l
       SET expires_at = NOW() + ($4::int * INTERVAL '1 second'),
           updated_at = NOW()
       FROM harness_runs r
       JOIN tickets t ON t.id = r.ticket_id
       JOIN agents a ON a.id = r.agent_id
       WHERE l.ticket_id = $1
         AND l.run_id = $2
         AND l.agent_id = $3
         AND l.expires_at > NOW()
         AND l.ticket_id = r.ticket_id
         AND l.agent_id = r.agent_id
         AND r.id = l.run_id
         AND r.status = 'running'
         AND t.status = 'in_progress'
         AND t.assigned_agent_id = a.id
       RETURNING l.*`,
      [normalisedTicketId, normalisedRunId, normalisedAgentId, ttl]
    );

    return result.rows[0] || null;
  }

  async releaseLease(ticketId, runId) {
    const normalisedTicketId = positiveInteger(ticketId, 'ticketId');
    const normalisedRunId = requiredUuid(runId, 'runId');

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
   * Runs that have no lease row (crash between startRun and claimLease, or a
   * lease stolen after expiry) are reaped once their heartbeat is stale. The
   * partial unique index prevents a second live run for the same ticket.
   *
   * Runs with a stored PR URL are marked `succeeded`, not failed, so reaping
   * never disagrees with publish evidence. Returns every reaped row, including
   * whether this call failed the run. Ticket changes belong in `reconcileRun`,
   * which re-checks the run/ticket/PR guards after this statement.
   */
  async reapExpiredLeases(limit = 50, orphanAfterSeconds = DEFAULT_ORPHAN_AFTER_SECONDS) {
    const parsedLimit = Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000) {
      throw new ValidationError('limit must be an integer between 1 and 1000');
    }
    const parsedOrphanAfter = Number(orphanAfterSeconds);
    if (
      !Number.isInteger(parsedOrphanAfter) ||
      parsedOrphanAfter < 1 ||
      parsedOrphanAfter > MAX_LEASE_SECONDS
    ) {
      throw new ValidationError(
        `orphanAfterSeconds must be an integer between 1 and ${MAX_LEASE_SECONDS}`
      );
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
         SET status = CASE
               WHEN NULLIF(BTRIM(r.pr_url), '') IS NOT NULL THEN 'succeeded'
               ELSE 'failed'
             END,
             finished_at = NOW(),
             error = CASE
               WHEN NULLIF(BTRIM(r.pr_url), '') IS NOT NULL THEN r.error
               ELSE COALESCE(r.error, 'lease expired without heartbeat')
             END
         FROM deleted d
         WHERE r.id = d.run_id AND r.status = 'running'
         RETURNING r.id, r.ticket_id, r.agent_id, r.status
       ),
       orphaned AS (
         SELECT r.id, r.ticket_id, r.agent_id
         FROM harness_runs r
         LEFT JOIN harness_leases l ON l.run_id = r.id
         WHERE r.status = 'running'
           AND l.run_id IS NULL
           AND r.heartbeat_at < NOW() - ($2::int * INTERVAL '1 second')
         ORDER BY r.heartbeat_at
         LIMIT $1
         FOR UPDATE OF r SKIP LOCKED
       ),
       orphan_failed AS (
         UPDATE harness_runs r
         SET status = CASE
               WHEN NULLIF(BTRIM(r.pr_url), '') IS NOT NULL THEN 'succeeded'
               ELSE 'failed'
             END,
             finished_at = NOW(),
             error = CASE
               WHEN NULLIF(BTRIM(r.pr_url), '') IS NOT NULL THEN r.error
               ELSE COALESCE(r.error, 'run has no lease and heartbeat is stale')
             END
         FROM orphaned o
         WHERE r.id = o.id
         RETURNING r.id, r.ticket_id, r.agent_id, r.status
       )
       SELECT d.ticket_id,
              d.run_id,
              d.agent_id,
              COALESCE(f.status = 'failed', FALSE) AS run_failed
       FROM deleted d
       LEFT JOIN failed f ON f.id = d.run_id
       UNION ALL
       SELECT o.ticket_id,
              o.id AS run_id,
              o.agent_id,
              (o.status = 'failed') AS run_failed
       FROM orphan_failed o`,
      [parsedLimit, parsedOrphanAfter]
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
module.exports.DEFAULT_ORPHAN_AFTER_SECONDS = DEFAULT_ORPHAN_AFTER_SECONDS;
