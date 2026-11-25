const { pool, transaction } = require('../db');
const {
  NotFoundError,
  ValidationError,
  ConflictError,
} = require('../errors/HttpError');

/**
 * fg-32b1: fix queue, atomic claim and lease renewal.
 *
 * A claim is a single transaction over the active fix request. Only due
 * `queued` rows are claimable; a live lease owned by another runtime conflicts,
 * while an expired lease is reclaimed and recorded as a `fix.lease_reclaimed`
 * harness event. `renew` only extends a live lease owned by the caller.
 */

const DEFAULT_LEASE_SECONDS = 1800;
const MIN_LEASE_SECONDS = 60;
const MAX_LEASE_SECONDS = 86_400;
const DEFAULT_QUEUE_LIMIT = 20;
const MAX_QUEUE_LIMIT = 100;

function positiveId(value, field) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError(`${field} must be a positive integer`);
  }
  return parsed;
}

function leaseValue(value) {
  const raw = value == null ? process.env.FIX_LEASE_TTL_SECONDS : value;
  const parsed = raw == null || raw === '' ? DEFAULT_LEASE_SECONDS : Number(raw);
  if (!Number.isInteger(parsed)
      || parsed < MIN_LEASE_SECONDS
      || parsed > MAX_LEASE_SECONDS) {
    throw new ValidationError(
      `lease seconds must be between ${MIN_LEASE_SECONDS} and ${MAX_LEASE_SECONDS}`);
  }
  return parsed;
}

function queueLimit(value) {
  const parsed = value == null ? DEFAULT_QUEUE_LIMIT : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_QUEUE_LIMIT) {
    throw new ValidationError(`limit must be between 1 and ${MAX_QUEUE_LIMIT}`);
  }
  return parsed;
}

class FixQueueService {
  async listQueue(projectId, options = {}) {
    const project = positiveId(projectId, 'projectId');
    const limit = queueLimit(options.limit);
    const { rows } = await pool.query(
      `SELECT fr.*,
              t.title,
              t.description,
              t.status AS ticket_status,
              t.phase AS ticket_phase,
              t.project_id,
              t.pr_url,
              t.review_round,
              t.reviewed_sha AS ticket_reviewed_sha,
              COALESCE((
                SELECT json_agg(json_build_object(
                         'severity', f.severity,
                         'file', f.file,
                         'line', f.line,
                         'message', f.message,
                         'suggestion', f.suggestion
                       ) ORDER BY f.severity, f.file NULLS LAST,
                                  f.line NULLS LAST, f.finding_key)
                  FROM ticket_review_findings f
                 WHERE f.attempt_id = fr.attempt_id
              ), '[]'::json) AS findings
         FROM ticket_fix_requests fr
         JOIN tickets t ON t.id = fr.ticket_id
        WHERE t.project_id = $1
          AND t.deleted_at IS NULL
          AND fr.state = 'queued'
          AND (fr.next_attempt_at IS NULL OR fr.next_attempt_at <= NOW())
        ORDER BY fr.created_at
        LIMIT $2`,
      [project, limit]
    );
    return rows;
  }

  async claim(ticketId, options = {}) {
    const ticket = positiveId(ticketId, 'ticketId');
    const runtime = positiveId(options.runtimeId, 'runtimeId');
    const lease = leaseValue(options.leaseSeconds);
    return transaction((client) =>
      this.claimWithClient(client, ticket, runtime, lease));
  }

  async claimWithClient(client, ticketId, runtimeId, leaseSeconds) {
    const selected = await client.query(
      `SELECT fr.*, t.project_id,
              (fr.lease_expires_at > NOW()) AS lease_live,
              (fr.next_attempt_at IS NULL OR fr.next_attempt_at <= NOW()) AS due
         FROM ticket_fix_requests fr
         JOIN tickets t ON t.id = fr.ticket_id
        WHERE fr.ticket_id = $1
          AND fr.state IN ('queued', 'claimed', 'fixing')
        FOR UPDATE OF fr`,
      [ticketId]
    );
    const request = selected.rows[0];
    if (!request) {
      throw new NotFoundError('No active fix request for this ticket');
    }

    if (request.state === 'queued') {
      if (!request.due) {
        throw new ConflictError('Fix request is not due yet');
      }
      const claimed = await client.query(
        `UPDATE ticket_fix_requests
            SET state = 'claimed',
                claimed_by = $2,
                lease_expires_at = NOW() + ($3 * INTERVAL '1 second'),
                updated_at = NOW()
          WHERE id = $1
            AND state = 'queued'
            AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
          RETURNING *`,
        [request.id, runtimeId, leaseSeconds]
      );
      if (!claimed.rows[0]) {
        throw new ConflictError('Fix request is no longer claimable');
      }
      await this.markFixing(client, ticketId);
      return { request: claimed.rows[0], claimed: true, reclaimed: false };
    }

    if (request.claimed_by != null && Number(request.claimed_by) === runtimeId
        && request.lease_live === true) {
      return { request, claimed: false, reclaimed: false };
    }
    if (request.lease_live === true) {
      throw new ConflictError('Fix request is claimed by another agent');
    }

    const reclaimed = await client.query(
      `UPDATE ticket_fix_requests
          SET state = 'claimed',
              claimed_by = $2,
              lease_expires_at = NOW() + ($3 * INTERVAL '1 second'),
              updated_at = NOW()
        WHERE id = $1
          AND state IN ('claimed', 'fixing')
        RETURNING *`,
      [request.id, runtimeId, leaseSeconds]
    );
    if (!reclaimed.rows[0]) {
      throw new ConflictError('Fix request is no longer claimable');
    }
    await this.markFixing(client, ticketId);
    await this.auditReclaim(client, request, runtimeId);
    return { request: reclaimed.rows[0], claimed: true, reclaimed: true };
  }

  async renew(ticketId, options = {}) {
    const ticket = positiveId(ticketId, 'ticketId');
    const runtime = positiveId(options.runtimeId, 'runtimeId');
    const lease = leaseValue(options.leaseSeconds);
    return transaction((client) =>
      this.renewWithClient(client, ticket, runtime, lease));
  }

  async renewWithClient(client, ticketId, runtimeId, leaseSeconds) {
    const selected = await client.query(
      `SELECT fr.*, (fr.lease_expires_at > NOW()) AS lease_live
         FROM ticket_fix_requests fr
        WHERE fr.ticket_id = $1
          AND fr.state IN ('claimed', 'fixing')
        FOR UPDATE OF fr`,
      [ticketId]
    );
    const request = selected.rows[0];
    if (!request) {
      throw new NotFoundError('No claimed fix request for this ticket');
    }
    if (request.claimed_by == null || Number(request.claimed_by) !== runtimeId) {
      throw new ConflictError('Fix lease is not owned by this agent');
    }
    if (request.lease_live !== true) {
      throw new ConflictError('Fix lease has expired; reclaim the request');
    }
    const renewed = await client.query(
      `UPDATE ticket_fix_requests
          SET lease_expires_at = NOW() + ($2 * INTERVAL '1 second'),
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [request.id, leaseSeconds]
    );
    return renewed.rows[0];
  }

  async markFixing(client, ticketId) {
    await client.query(
      `UPDATE tickets
          SET review_state = 'fixing', updated_at = NOW()
        WHERE id = $1`,
      [ticketId]
    );
  }

  async auditReclaim(client, request, runtimeId) {
    await client.query(
      `INSERT INTO harness_events
         (event_id, trace_id, ticket_id, project_id, agent_id, type, payload)
       VALUES (gen_random_uuid(), gen_random_uuid(), $1, $2, $3,
               'fix.lease_reclaimed', $4::jsonb)`,
      [
        request.ticket_id,
        request.project_id,
        runtimeId,
        JSON.stringify({
          requestId: request.id,
          previousOwner: request.claimed_by,
          previousLeaseExpiresAt: request.lease_expires_at,
        }),
      ]
    );
  }
}

const service = new FixQueueService();
module.exports = service;
module.exports.FixQueueService = FixQueueService;
module.exports.leaseValue = leaseValue;
