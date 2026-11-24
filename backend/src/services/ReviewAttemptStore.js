const { pool } = require('../db');
const { ValidationError, ConflictError } = require('../errors/HttpError');

/**
 * fg-31a: persistence for harness review attempts.
 *
 * Only `completed` attempts are idempotent per (ticket, SHA); `failed` and
 * stale `started` attempts stay retryable. Findings live in
 * ReviewFindingStore and are consumed by fg-32.
 */

const STATUSES = Object.freeze(['started', 'completed', 'failed']);
const VERDICTS = Object.freeze(['approve', 'request_changes', 'comment']);
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value.trim())) {
    throw new ValidationError('reviewedSha must be a 40- or 64-character hexadecimal SHA');
  }
  return value.trim().toLowerCase();
}

function roundValue(value) {
  if (value == null) return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ValidationError('round must be a non-negative integer');
  }
  return parsed;
}

function optionalText(value, field, max = 255) {
  if (value == null) return null;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${field} must be a non-empty string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new ValidationError(`${field} exceeds ${max} characters`);
  }
  return trimmed;
}

function optionalNonNegativeInt(value, field) {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ValidationError(`${field} must be a non-negative integer`);
  }
  return parsed;
}

function verdictValue(value) {
  if (!VERDICTS.includes(value)) {
    throw new ValidationError(`verdict must be one of: ${VERDICTS.join(', ')}`);
  }
  return value;
}

function statusValue(value) {
  if (!STATUSES.includes(value)) {
    throw new ValidationError(`status must be one of: ${STATUSES.join(', ')}`);
  }
  return value;
}

function listOptions({ limit = DEFAULT_LIMIT, offset = 0, status = null } = {}) {
  const parsedLimit = Number(limit);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_LIMIT) {
    throw new ValidationError(`limit must be between 1 and ${MAX_LIMIT}`);
  }
  const parsedOffset = Number(offset);
  if (!Number.isInteger(parsedOffset) || parsedOffset < 0) {
    throw new ValidationError('offset must be a non-negative integer');
  }
  return {
    limit: parsedLimit,
    offset: parsedOffset,
    status: status == null ? null : statusValue(status),
  };
}

async function start({ ticketId, reviewedSha: sha, round = 0, provider = null, model = null } = {}) {
  const ticket = positiveId(ticketId, 'ticketId');
  const reviewed = reviewedSha(sha);
  const roundNumber = roundValue(round);
  const providerName = optionalText(provider, 'provider');
  const modelName = optionalText(model, 'model');

  const { rows } = await pool.query(
    `INSERT INTO ticket_review_attempts
       (ticket_id, reviewed_sha, status, round, provider, model)
     VALUES ($1, $2, 'started', $3, $4, $5)
     RETURNING *`,
    [ticket, reviewed, roundNumber, providerName, modelName]
  );
  return rows[0];
}

async function complete(id, {
  verdict,
  verification = null,
  githubReviewId = null,
  tokensIn = null,
  tokensOut = null,
  durationMs = null,
} = {}) {
  const attemptId = uuid(id, 'id');
  const result = verdictValue(verdict);
  const reviewId = githubReviewId == null ? null : positiveId(githubReviewId, 'githubReviewId');
  const input = optionalNonNegativeInt(tokensIn, 'tokensIn');
  const output = optionalNonNegativeInt(tokensOut, 'tokensOut');
  const duration = optionalNonNegativeInt(durationMs, 'durationMs');

  try {
    const { rows } = await pool.query(
      `UPDATE ticket_review_attempts
          SET status = 'completed',
              verdict = $2,
              verification = $3,
              github_review_id = COALESCE($4, github_review_id),
              tokens_in = $5,
              tokens_out = $6,
              duration_ms = $7,
              failure_reason = NULL,
              completed_at = NOW()
        WHERE id = $1 AND status IN ('started', 'failed')
        RETURNING *`,
      [attemptId, result, verification, reviewId, input, output, duration]
    );
    if (rows[0]) return rows[0];
    // Already completed (or concurrently completed) is an idempotent success.
    const current = await findById(attemptId);
    return current && current.status === 'completed' ? current : null;
  } catch (error) {
    if (error.code !== '23505') throw error;
    const duplicate = await findById(attemptId);
    if (!duplicate) {
      throw new ConflictError('A completed review already exists for this ticket and SHA');
    }
    await fail(attemptId, 'duplicate completed review');
    const existing = await findCompleted(duplicate.ticket_id, duplicate.reviewed_sha);
    if (existing) return existing;
    throw new ConflictError('A completed review already exists for this ticket and SHA');
  }
}

async function fail(id, reason) {
  const attemptId = uuid(id, 'id');
  const failure = optionalText(reason, 'reason', 2000);
  if (!failure) {
    throw new ValidationError('reason is required');
  }
  const { rows } = await pool.query(
    `UPDATE ticket_review_attempts
        SET status = 'failed',
            failure_reason = $2,
            completed_at = NOW()
      WHERE id = $1 AND status IN ('started', 'failed')
      RETURNING *`,
    [attemptId, failure]
  );
  return rows[0] || null;
}

async function findById(id) {
  const attemptId = uuid(id, 'id');
  const { rows } = await pool.query(
    'SELECT * FROM ticket_review_attempts WHERE id = $1',
    [attemptId]
  );
  return rows[0] || null;
}

async function findCompleted(ticketId, reviewedShaValue) {
  const ticket = positiveId(ticketId, 'ticketId');
  const sha = reviewedSha(reviewedShaValue);
  const { rows } = await pool.query(
    `SELECT * FROM ticket_review_attempts
      WHERE ticket_id = $1 AND reviewed_sha = $2 AND status = 'completed'
      ORDER BY completed_at DESC
      LIMIT 1`,
    [ticket, sha]
  );
  return rows[0] || null;
}

async function listForTicket(ticketId, options = {}) {
  const ticket = positiveId(ticketId, 'ticketId');
  const { limit, offset, status } = listOptions(options);
  const { rows } = await pool.query(
    `SELECT * FROM ticket_review_attempts
      WHERE ticket_id = $1
        AND ($2::text IS NULL OR status = $2)
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4`,
    [ticket, status, limit, offset]
  );
  return rows;
}

module.exports = {
  STATUSES,
  VERDICTS,
  start,
  complete,
  fail,
  findById,
  findCompleted,
  listForTicket,
};
