const { transaction, pool } = require('../db');
const FixBranchResolver = require('./FixBranchResolver');
const {
  NotFoundError,
  ValidationError,
  ConflictError,
} = require('../errors/HttpError');

/**
 * fg-32a: structured fix requests.
 *
 * A reviewer posts its COMMENT review, writes the completed attempt and calls
 * this service with the attempt id. The service creates exactly one fix
 * request per attempt and moves the ticket `review -> in_progress` (phase and
 * status) in one transaction. Claim/lease/round/escalation writes are later
 * fg-32 slices.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/i;
const ACTIVE_STATES = ['queued', 'claimed', 'fixing'];
const MAX_FEEDBACK = 8192;

function positiveId(value, field) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError(`${field} must be a positive integer`);
  }
  return parsed;
}

function uuid(value, field) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new ValidationError(`${field} must be a UUID`);
  }
  return value;
}

function reviewedSha(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError('reviewedSha is required');
  }
  const sha = value.trim().toLowerCase();
  if (!SHA_RE.test(sha)) {
    throw new ValidationError('reviewedSha must be a 40- or 64-character hexadecimal SHA');
  }
  return sha;
}

function optionalFeedback(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') {
    throw new ValidationError('feedback must be a string');
  }
  const feedback = value.trim();
  if (feedback.length > MAX_FEEDBACK) {
    throw new ValidationError(`feedback exceeds ${MAX_FEEDBACK} characters`);
  }
  return feedback || null;
}

function roundValue(value) {
  const round = value == null ? 0 : Number(value);
  if (!Number.isInteger(round) || round < 0) {
    throw new ValidationError('review round must be a non-negative integer');
  }
  return round;
}

function activePlaceholders() {
  return ACTIVE_STATES.map((_, index) => `$${index + 2}`).join(', ');
}

class FixRequestService {
  constructor(options = {}) {
    this.branchResolver = options.branchResolver || new FixBranchResolver();
  }

  /**
   * Create or return the fix request for one attempt (or a manual request).
   *
   * @param {object} [options] {@code db} client for PhaseService integration
   * and {@code actorId} for the phase history.
   */
  async createOrEnsure(ticketId, input = {}, options = {}) {
    const id = positiveId(ticketId, 'ticketId');
    if (options.db) {
      return this.createOrEnsureWithClient(options.db, id, input, options);
    }
    // Resolve the branch/SHA (including any provider lookup) before opening
    // the transaction, so no pool client or ticket lock is held across
    // provider latency/retries.
    const preResolved = await this.preResolve(id, input);
    if (preResolved.existing) {
      return { request: preResolved.existing, created: false };
    }
    return transaction((client) =>
      this.createOrEnsureWithClient(client, id, input, {
        ...options,
        branchResolution: preResolved.branchResolution,
      }));
  }

  async preResolve(ticketId, input = {}) {
    const id = positiveId(ticketId, 'ticketId');
    const attemptId = input.attemptId == null || input.attemptId === ''
      ? null
      : uuid(input.attemptId, 'attemptId');
    if (!attemptId && !optionalFeedback(input.feedback)) {
      throw new ValidationError('feedback is required for a manual fix request');
    }

    const ticketResult = await pool.query(
      'SELECT * FROM tickets WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    if (ticketResult.rows.length === 0) {
      throw new NotFoundError('Ticket not found');
    }
    const ticket = ticketResult.rows[0];

    // Idempotent retries must win even after the first request moved the
    // ticket to in_progress.
    if (attemptId) {
      const existing = await pool.query(
        'SELECT * FROM ticket_fix_requests WHERE attempt_id = $1 AND ticket_id = $2',
        [attemptId, id]
      );
      if (existing.rows[0]) return { existing: existing.rows[0] };
    } else {
      const active = await this.findActive(pool, id);
      if (active) return { existing: active };
    }

    if (ticket.status !== 'review') {
      throw new ConflictError('Ticket must be in review before a fix request');
    }
    if (ticket.phase !== 'review') {
      throw new ConflictError('Ticket phase must be review before a fix request');
    }

    const resolved = attemptId
      ? await this.resolveFromAttempt(pool, id, attemptId)
      : await this.resolveManual(pool, ticket);
    const branchResolution = await this.branchResolver.resolve(ticket, {
      reviewedSha: resolved.reviewedSha,
      round: resolved.round,
    });
    return { branchResolution };
  }

  async createOrEnsureWithClient(client, ticketId, input = {}, options = {}) {
    const id = positiveId(ticketId, 'ticketId');
    const attemptId = input.attemptId == null || input.attemptId === ''
      ? null
      : uuid(input.attemptId, 'attemptId');
    const source = attemptId ? 'reviewer' : 'human';
    const feedback = optionalFeedback(input.feedback);
    if (!attemptId && !feedback) {
      throw new ValidationError('feedback is required for a manual fix request');
    }
    if (source === 'human' && input.source != null && input.source !== 'human') {
      throw new ValidationError('source must be human for a manual fix request');
    }

    const ticketResult = await client.query(
      'SELECT * FROM tickets WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
      [id]
    );
    if (ticketResult.rows.length === 0) {
      throw new NotFoundError('Ticket not found');
    }
    const ticket = ticketResult.rows[0];

    if (attemptId) {
      const existing = await client.query(
        'SELECT * FROM ticket_fix_requests WHERE attempt_id = $1 AND ticket_id = $2',
        [attemptId, id]
      );
      if (existing.rows[0]) {
        return { request: existing.rows[0], created: false };
      }
    } else {
      const active = await this.findActive(client, id);
      if (active) {
        return { request: active, created: false };
      }
    }

    const resolved = attemptId
      ? await this.resolveFromAttempt(client, id, attemptId)
      : await this.resolveManual(client, ticket);
    if (ticket.status !== 'review') {
      throw new ConflictError('Ticket must be in review before a fix request');
    }
    if (ticket.phase !== 'review') {
      throw new ConflictError('Ticket phase must be review before a fix request');
    }

    const branchResolution = options.branchResolution
      || await this.branchResolver.resolve(ticket, {
        reviewedSha: resolved.reviewedSha,
        round: resolved.round,
      });
    const branch = branchResolution.branch;
    const finalReviewedSha = branchResolution.reviewedSha;
    const round = branchResolution.round;

    const active = await this.findActive(client, id);
    if (active) {
      throw new ConflictError('An active fix request already exists for this ticket');
    }

    const fromPhase = ticket.phase;
    const actorType = attemptId ? 'agent' : 'human';
    const actorId = options.actorId == null ? null : String(options.actorId);

    await client.query(
      `UPDATE tickets
          SET phase = 'in_progress',
              status = 'in_progress',
              review_state = 'changes_requested',
              review_round = $2,
              reviewed_sha = $3,
              fix_branch = $4,
              updated_at = NOW()
        WHERE id = $1`,
      [id, round, finalReviewedSha, branch]
    );

    await client.query(
      `INSERT INTO ticket_phases
         (ticket_id, from_phase, to_phase, actor_type, actor_id, metadata, created_at)
       VALUES ($1, $2, 'in_progress', $3, $4, $5::jsonb, NOW())`,
      [
        id,
        fromPhase,
        actorType,
        actorId,
        JSON.stringify({ source, attemptId, reviewState: 'changes_requested' }),
      ]
    );

    try {
      const inserted = await client.query(
        `INSERT INTO ticket_fix_requests
           (ticket_id, attempt_id, source, branch, reviewed_sha, state, feedback)
         VALUES ($1, $2, $3, $4, $5, 'queued', $6)
         RETURNING *`,
        [id, attemptId, source, branch, finalReviewedSha, feedback]
      );
      return { request: inserted.rows[0], created: true };
    } catch (error) {
      if (error.code === '23505') {
        if (attemptId) {
          const existing = await client.query(
            'SELECT * FROM ticket_fix_requests WHERE attempt_id = $1 AND ticket_id = $2',
            [attemptId, id]
          );
          if (existing.rows[0]) {
            return { request: existing.rows[0], created: false };
          }
        }
        throw new ConflictError('An active fix request already exists for this ticket');
      }
      throw error;
    }
  }

  async findActive(client, ticketId) {
    const placeholders = activePlaceholders();
    const result = await client.query(
      `SELECT * FROM ticket_fix_requests
        WHERE ticket_id = $1 AND state IN (${placeholders})
        ORDER BY created_at DESC
        LIMIT 1`,
      [ticketId, ...ACTIVE_STATES]
    );
    return result.rows[0] || null;
  }

  async resolveFromAttempt(client, ticketId, attemptId) {
    const attemptResult = await client.query(
      'SELECT * FROM ticket_review_attempts WHERE id = $1',
      [attemptId]
    );
    const attempt = attemptResult.rows[0];
    if (!attempt || Number(attempt.ticket_id) !== ticketId) {
      throw new NotFoundError('Review attempt not found for this ticket');
    }
    if (attempt.status !== 'completed') {
      throw new ConflictError('Review attempt is not completed');
    }
    if (attempt.verdict !== 'request_changes') {
      throw new ConflictError('Review attempt did not request changes');
    }
    return {
      reviewedSha: reviewedSha(attempt.reviewed_sha),
      round: roundValue(attempt.round),
    };
  }

  async resolveManual(client, ticket) {
    const latest = await client.query(
      `SELECT reviewed_sha, round
         FROM ticket_review_attempts
        WHERE ticket_id = $1 AND status = 'completed'
        ORDER BY completed_at DESC NULLS LAST, created_at DESC
        LIMIT 1`,
      [ticket.id]
    );
    const row = latest.rows[0];
    if (row && row.reviewed_sha) {
      return {
        reviewedSha: reviewedSha(row.reviewed_sha),
        round: roundValue(row.round),
      };
    }
    if (ticket.reviewed_sha) {
      return {
        reviewedSha: reviewedSha(ticket.reviewed_sha),
        round: roundValue(ticket.review_round),
      };
    }
    return {
      reviewedSha: ticket.reviewed_sha ? reviewedSha(ticket.reviewed_sha) : null,
      round: roundValue(ticket.review_round),
    };
  }
}

const service = new FixRequestService();
module.exports = service;
module.exports.FixRequestService = FixRequestService;
