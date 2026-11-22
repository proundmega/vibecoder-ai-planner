const crypto = require('crypto');
const { pool } = require('../db');
const NotificationService = require('./NotificationService');
const { redactText } = require('../utils/harnessRedaction');
const {
  NotFoundError,
  ValidationError,
  ForbiddenError,
  ConflictError,
} = require('../errors/HttpError');
const logger = require('../utils/logger');

/**
 * Human question loop persistence (fg-55).
 *
 * A question is always tied to a running harness run. Creating one marks the
 * run waiting; answering or expiring it clears the marker and adds the wait to
 * `waited_ms` so wall-clock budget accounting excludes human latency. The run
 * keeps `status='running'` throughout, which is what keeps the lease, the
 * active-run index and the reaper queries unchanged.
 */

const KINDS = Object.freeze(['question', 'permission', 'doom_loop']);
const STATUSES = Object.freeze(['pending', 'answered', 'expired', 'cancelled']);
const MAX_TEXT = 8192;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

function positiveInt(value, field) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError(`${field} must be a positive integer`);
  }
  return parsed;
}

function requiredUuid(value, field) {
  if (typeof value !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ValidationError(`${field} must be a UUID`);
  }
  return value;
}

function capText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${field} is required`);
  }
  if (value.length > MAX_TEXT) {
    const error = new ValidationError(`${field} exceeds ${MAX_TEXT} characters`);
    error.code = 'PROMPT_TOO_LONG';
    throw error;
  }
  const redacted = redactText(value);
  if (redacted.length > MAX_TEXT) {
    const error = new ValidationError(`${field} exceeds ${MAX_TEXT} characters`);
    error.code = 'PROMPT_TOO_LONG';
    throw error;
  }
  return redacted;
}

function kindValue(value) {
  const kind = value == null ? 'question' : String(value);
  if (!KINDS.includes(kind)) {
    throw new ValidationError(`kind must be one of: ${KINDS.join(', ')}`);
  }
  return kind;
}

function statusValue(value) {
  if (value == null || value === '') return null;
  if (!STATUSES.includes(value)) {
    throw new ValidationError(`status must be one of: ${STATUSES.join(', ')}`);
  }
  return value;
}

function listOptions({ status = null, limit = DEFAULT_LIST_LIMIT, offset = 0 } = {}) {
  const parsedLimit = Number(limit);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_LIST_LIMIT) {
    throw new ValidationError(`limit must be an integer between 1 and ${MAX_LIST_LIMIT}`);
  }
  const parsedOffset = Number(offset);
  if (!Number.isInteger(parsedOffset) || parsedOffset < 0) {
    throw new ValidationError('offset must be a non-negative integer');
  }
  return { status: statusValue(status), limit: parsedLimit, offset: parsedOffset };
}

function conflict(message, code) {
  const error = new ConflictError(message);
  error.code = code;
  return error;
}

async function emitQuestionEvent(type, question, payload = {}) {
  try {
    // Lazy require avoids a service cycle at module load.
    const HarnessEventService = require('./HarnessEventService');
    const trace = await pool.query(
      `SELECT trace_id FROM harness_events
       WHERE run_id = $1 ORDER BY event_timestamp ASC LIMIT 1`,
      [question.run_id]
    );
    await HarnessEventService.emit({
      eventId: crypto.randomUUID(),
      traceId: trace.rows[0]?.trace_id || crypto.randomUUID(),
      runId: question.run_id,
      runtimeId: question.runtime_id,
      type,
      payload: {
        questionId: String(question.id),
        kind: question.kind,
        status: question.status,
        ...payload,
      },
    });
  } catch (error) {
    // Observability must never turn a stored question/answer into a failure.
    logger.warn(`Could not emit ${type} for question ${question.id}: ${error.message}`);
  }
}

class TicketQuestionService {
  async createForRun({
    runId,
    runtimeId,
    externalId = null,
    kind = 'question',
    prompt,
    options = null,
    expiresAt = null,
  } = {}) {
    const run = requiredUuid(runId, 'runId');
    const runtime = positiveInt(runtimeId, 'runtimeId');
    const questionKind = kindValue(kind);
    const text = capText(prompt, 'prompt');
    const external = externalId == null || String(externalId).trim() === ''
      ? null
      : String(externalId).trim().slice(0, 255);
    let expires = null;
    if (expiresAt != null && expiresAt !== '') {
      const parsed = new Date(expiresAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new ValidationError('expiresAt must be a timestamp');
      }
      expires = parsed.toISOString();
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const runRow = await client.query(
        `SELECT id, ticket_id, project_id, runtime_id, status
         FROM harness_runs WHERE id = $1 FOR UPDATE`,
        [run]
      );
      if (runRow.rows.length === 0) {
        throw new NotFoundError('Harness run not found');
      }
      const running = runRow.rows[0];
      if (String(running.runtime_id) !== String(runtime)) {
        throw new ForbiddenError('Harness run belongs to another runtime');
      }
      if (running.status !== 'running') {
        throw conflict('Harness run is not active', 'QUESTION_RUN_INACTIVE');
      }

      // Idempotent create: a repeated OpenCode event returns the stored row and
      // never creates a second notification.
      if (external) {
        const existing = await client.query(
          `SELECT * FROM ticket_questions
           WHERE run_id = $1 AND external_id = $2`,
          [run, external]
        );
        if (existing.rows.length > 0) {
          await client.query('COMMIT');
          return existing.rows[0];
        }
      }

      const inserted = await client.query(
        `INSERT INTO ticket_questions
           (run_id, ticket_id, project_id, runtime_id, external_id, kind,
            status, prompt, options, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8::jsonb, $9)
         ${external ? 'ON CONFLICT (run_id, external_id) WHERE external_id IS NOT NULL DO NOTHING' : ''}
         RETURNING *`,
        [
          run,
          running.ticket_id,
          running.project_id,
          runtime,
          external,
          questionKind,
          text,
          options == null ? null : JSON.stringify(options),
          expires,
        ]
      );

      let question = inserted.rows[0];
      if (!question && external) {
        const existing = await client.query(
          `SELECT * FROM ticket_questions
           WHERE run_id = $1 AND external_id = $2`,
          [run, external]
        );
        question = existing.rows[0];
      }
      if (!question) {
        throw new ConflictError('Question could not be stored');
      }

      await client.query(
        `UPDATE harness_runs
         SET waiting_since = COALESCE(waiting_since, NOW()),
             heartbeat_at = NOW()
         WHERE id = $1`,
        [run]
      );

      await NotificationService.createForQuestion(question, { client });
      await client.query('COMMIT');

      emitQuestionEvent('question.asked', question);
      return question;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async getForRun(runId, questionId) {
    const run = requiredUuid(runId, 'runId');
    const id = positiveInt(questionId, 'questionId');
    const result = await pool.query(
      'SELECT * FROM ticket_questions WHERE id = $1 AND run_id = $2',
      [id, run]
    );
    if (result.rows.length === 0) {
      throw new NotFoundError('Question not found');
    }
    return result.rows[0];
  }

  async listForRun(runId, options = {}) {
    const run = requiredUuid(runId, 'runId');
    const { status, limit, offset } = listOptions(options);
    const params = [run];
    let predicate = '';
    if (status) {
      params.push(status);
      predicate = `AND status = $${params.length}`;
    }
    params.push(limit, offset);
    const result = await pool.query(
      `SELECT * FROM ticket_questions
       WHERE run_id = $1 ${predicate}
       ORDER BY created_at DESC, id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return result.rows;
  }

  async listForTicket(ticketId, options = {}) {
    const id = positiveInt(ticketId, 'ticketId');
    const { status, limit, offset } = listOptions(options);
    const params = [id];
    let predicate = '';
    if (status) {
      params.push(status);
      predicate = `AND q.status = $${params.length}`;
    }
    params.push(limit, offset);
    const result = await pool.query(
      `SELECT q.*, u.name AS answered_by_name
       FROM ticket_questions q
       LEFT JOIN users u ON u.id = q.answered_by
       WHERE q.ticket_id = $1 ${predicate}
       ORDER BY q.created_at DESC, q.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return result.rows;
  }

  async listForProject(projectId, options = {}) {    const id = positiveInt(projectId, 'projectId');
    const { status, limit, offset } = listOptions(options);
    const params = [id];
    let predicate = '';
    if (status) {
      params.push(status);
      predicate = `AND q.status = $${params.length}`;
    }
    params.push(limit, offset);
    const result = await pool.query(
      `SELECT q.*, t.title AS ticket_title, u.name AS answered_by_name
       FROM ticket_questions q
       JOIN tickets t ON t.id = q.ticket_id
       LEFT JOIN users u ON u.id = q.answered_by
       WHERE q.project_id = $1 ${predicate}
       ORDER BY q.created_at DESC, q.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return result.rows;
  }

  /**
   * Inbox across every project the user owns or belongs to. Kept separate from
   * the project listing so the bell/inbox does not need a project selector.
   */
  async listForUser(userId, options = {}) {
    const id = positiveInt(userId, 'userId');
    const { status, limit, offset } = listOptions(options);
    const params = [id];
    let predicate = '';
    if (status) {
      params.push(status);
      predicate = `AND q.status = $${params.length}`;
    }
    params.push(limit, offset);
    const result = await pool.query(
      `SELECT q.*, t.title AS ticket_title, p.name AS project_name
       FROM ticket_questions q
       JOIN tickets t ON t.id = q.ticket_id
       JOIN projects p ON p.id = q.project_id
       WHERE (p.owner_id = $1
              OR EXISTS (
                SELECT 1 FROM project_memberships pm
                WHERE pm.project_id = p.id AND pm.user_id = $1
              ))
         ${predicate}
       ORDER BY q.created_at DESC, q.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return result.rows;
  }

  async answer(runId, questionId, { answer, userId } = {}) {
    const run = requiredUuid(runId, 'runId');
    const id = positiveInt(questionId, 'questionId');
    const user = positiveInt(userId, 'userId');
    const text = capText(answer, 'answer');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query(
        `SELECT q.*, r.status AS run_status
         FROM ticket_questions q
         JOIN harness_runs r ON r.id = q.run_id
         WHERE q.id = $1 AND q.run_id = $2
         FOR UPDATE OF q`,
        [id, run]
      );
      if (selected.rows.length === 0) {
        throw new NotFoundError('Question not found');
      }
      const question = selected.rows[0];
      if (question.status === 'answered') {
        throw conflict('Question already answered', 'QUESTION_ALREADY_ANSWERED');
      }
      if (question.status === 'expired' || question.status === 'cancelled') {
        throw conflict('Question expired', 'QUESTION_EXPIRED');
      }
      if (question.expires_at && new Date(question.expires_at).getTime() <= Date.now()) {
        await client.query(
          "UPDATE ticket_questions SET status = 'expired' WHERE id = $1",
          [id]
        );
        await this.clearWaitingWith(client, run);
        await client.query('COMMIT');
        throw conflict('Question expired', 'QUESTION_EXPIRED');
      }

      const updated = await client.query(
        `UPDATE ticket_questions
         SET status = 'answered',
             answer = $3,
             answered_by = $4,
             answered_at = NOW()
         WHERE id = $1 AND status = 'pending'
         RETURNING *`,
        [id, run, text, user]
      );
      if (updated.rows.length === 0) {
        throw conflict('Question is no longer pending', 'QUESTION_ALREADY_ANSWERED');
      }

      await this.clearWaitingWith(client, run);
      await NotificationService.markQuestionRead(user, id, { client });
      await client.query('COMMIT');

      emitQuestionEvent('question.answered', updated.rows[0], { answeredBy: String(user) });
      return updated.rows[0];
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async expire(runId, questionId) {
    const run = requiredUuid(runId, 'runId');
    const id = positiveInt(questionId, 'questionId');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query(
        'SELECT * FROM ticket_questions WHERE id = $1 AND run_id = $2 FOR UPDATE',
        [id, run]
      );
      if (selected.rows.length === 0) {
        throw new NotFoundError('Question not found');
      }
      if (selected.rows[0].status !== 'pending') {
        await client.query('COMMIT');
        return selected.rows[0];
      }
      const updated = await client.query(
        `UPDATE ticket_questions
         SET status = 'expired'
         WHERE id = $1 AND run_id = $2 AND status = 'pending'
         RETURNING *`,
        [id, run]
      );
      await this.clearWaitingWith(client, run);
      await client.query('COMMIT');
      emitQuestionEvent('question.timeout', updated.rows[0]);
      return updated.rows[0];
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async expirePendingForRun(runId, reason = null) {
    const run = requiredUuid(runId, 'runId');
    const result = await pool.query(
      `UPDATE ticket_questions
       SET status = 'expired'
       WHERE run_id = $1 AND status = 'pending'
       RETURNING *`,
      [run]
    );
    await this.clearWaiting(run);
    for (const question of result.rows) {
      emitQuestionEvent('question.timeout', question, {
        reason: reason ? redactText(String(reason)) : 'run finished',
      });
    }
    return result.rows;
  }

  async clearWaiting(runId) {
    const run = requiredUuid(runId, 'runId');
    await pool.query(
      `UPDATE harness_runs
       SET waited_ms = waited_ms
             + CASE
                 WHEN waiting_since IS NULL THEN 0
                 ELSE GREATEST(0,
                   ROUND(EXTRACT(EPOCH FROM (NOW() - waiting_since)) * 1000))::bigint
               END,
           waiting_since = NULL
       WHERE id = $1`,
      [run]
    );
  }

  async clearWaitingWith(client, runId) {
    await client.query(
      `UPDATE harness_runs
       SET waited_ms = waited_ms
             + CASE
                 WHEN waiting_since IS NULL THEN 0
                 ELSE GREATEST(0, ROUND(EXTRACT(EPOCH FROM (NOW() - waiting_since)) * 1000))::bigint
               END,
           waiting_since = NULL
       WHERE id = $1`,
      [runId]
    );
  }
}

module.exports = new TicketQuestionService();
module.exports.TicketQuestionService = TicketQuestionService;
module.exports.QUESTION_KINDS = KINDS;
module.exports.QUESTION_STATUSES = STATUSES;
module.exports.MAX_QUESTION_TEXT = MAX_TEXT;
