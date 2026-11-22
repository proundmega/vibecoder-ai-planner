const { pool } = require('../db');
const { redactPayload, redactText } = require('../utils/harnessRedaction');
const {
  NotFoundError,
  ValidationError,
} = require('../errors/HttpError');

/**
 * Per-user in-app notifications (fg-55).
 *
 * A notification is always derived from a real state change: a question that
 * was persisted, or a run that reached a terminal status. Text is redacted and
 * capped here even when the caller already redacted it, so a bell payload can
 * never carry a credential or a full prompt.
 */

const TYPES = Object.freeze([
  'question',
  'run_succeeded',
  'run_failed',
  'budget_exceeded',
]);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const PREVIEW_CHARS = 200;

function positiveInt(value, field) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError(`${field} must be a positive integer`);
  }
  return parsed;
}

function preview(text) {
  if (text === null || text === undefined) return '';
  const clean = redactText(String(text));
  return clean.length > PREVIEW_CHARS
    ? `${clean.slice(0, PREVIEW_CHARS)}…`
    : clean;
}

function safePayload(payload) {
  return redactPayload(payload && typeof payload === 'object' ? payload : {}).payload;
}

async function insertOne(client, { userId, projectId, ticketId, runId, questionId, type, payload }) {
  const result = await client.query(
    `INSERT INTO notifications
       (user_id, project_id, ticket_id, run_id, question_id, type, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING *`,
    [
      userId,
      projectId == null ? null : projectId,
      ticketId == null ? null : ticketId,
      runId == null ? null : runId,
      questionId == null ? null : questionId,
      type,
      JSON.stringify(safePayload(payload)),
    ]
  );
  return result.rows[0];
}

class NotificationService {
  /**
   * The project owner plus members whose project role carries AGENT_READ,
   * deduplicated. A user without project access never receives a row.
   */
  async recipientsForProject(projectId, { client = null } = {}) {
    const db = client || pool;
    const result = await db.query(
      `SELECT p.owner_id AS user_id
       FROM projects p
       WHERE p.id = $1 AND p.owner_id IS NOT NULL
       UNION
       SELECT pm.user_id
       FROM project_memberships pm
       JOIN roles r ON r.name = pm.role
       JOIN role_permissions rp ON rp.role_id = r.id
       JOIN permissions perm ON perm.id = rp.permission_id
       WHERE pm.project_id = $1 AND perm.code = 'AGENT_READ'`,
      [Number(projectId)]
    );
    return [...new Set(result.rows.map((row) => String(row.user_id)))];
  }

  /**
   * Fan out one question notification per recipient. The caller passes its
   * transaction client so the question and its notifications commit together.
   */
  async createForQuestion(question, { recipients = null, client = null } = {}) {
    if (!question || !question.id) {
      throw new ValidationError('question is required');
    }
    const tx = client || (await pool.connect());
    const ownTransaction = !client;
    try {
      if (ownTransaction) await tx.query('BEGIN');
      const users = recipients
        || await this.recipientsForProject(question.project_id, { client: tx });
      const rows = [];
      for (const userId of users) {
        rows.push(await insertOne(tx, {
          userId,
          projectId: question.project_id,
          ticketId: question.ticket_id,
          runId: question.run_id,
          questionId: question.id,
          type: 'question',
          payload: {
            kind: question.kind,
            preview: preview(question.prompt),
          },
        }));
      }
      if (ownTransaction) await tx.query('COMMIT');
      return rows;
    } catch (error) {
      if (ownTransaction) await tx.query('ROLLBACK');
      throw error;
    } finally {
      if (ownTransaction) tx.release();
    }
  }

  /**
   * Notify the project audience about a terminal run. `type` is derived from
   * the run status when the caller does not provide it.
   */
  async createForRunFinish(run, { type = null, payload = {}, client = null } = {}) {
    if (!run || !run.id) {
      throw new ValidationError('run is required');
    }
    const notificationType = type || (
      run.status === 'succeeded'
        ? 'run_succeeded'
        : (run.status === 'budget_exceeded' ? 'budget_exceeded' : 'run_failed')
    );
    if (!TYPES.includes(notificationType)) {
      throw new ValidationError('Unknown notification type');
    }
    const tx = client || (await pool.connect());
    const ownTransaction = !client;
    try {
      if (ownTransaction) await tx.query('BEGIN');
      const users = await this.recipientsForProject(run.project_id, { client: tx });
      const rows = [];
      for (const userId of users) {
        rows.push(await insertOne(tx, {
          userId,
          projectId: run.project_id,
          ticketId: run.ticket_id,
          runId: run.id,
          questionId: null,
          type: notificationType,
          payload: {
            status: run.status,
            error: run.error || null,
            prUrl: run.pr_url || null,
            ...payload,
          },
        }));
      }
      if (ownTransaction) await tx.query('COMMIT');
      return rows;
    } catch (error) {
      if (ownTransaction) await tx.query('ROLLBACK');
      throw error;
    } finally {
      if (ownTransaction) tx.release();
    }
  }

  async listForUser(userId, { unread = false, limit = DEFAULT_LIMIT, offset = 0 } = {}) {
    const id = positiveInt(userId, 'userId');
    const parsedLimit = Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_LIMIT) {
      throw new ValidationError(`limit must be an integer between 1 and ${MAX_LIMIT}`);
    }
    const parsedOffset = Number(offset);
    if (!Number.isInteger(parsedOffset) || parsedOffset < 0) {
      throw new ValidationError('offset must be a non-negative integer');
    }
    const params = [id];
    let predicate = '';
    if (unread === true || unread === 'true') {
      predicate = 'AND read_at IS NULL';
    }
    params.push(parsedLimit, parsedOffset);
    const result = await pool.query(
      `SELECT * FROM notifications
       WHERE user_id = $1 ${predicate}
       ORDER BY created_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      params
    );
    return result.rows;
  }

  async unreadCount(userId) {
    const id = positiveInt(userId, 'userId');
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM notifications
       WHERE user_id = $1 AND read_at IS NULL`,
      [id]
    );
    return Number(result.rows[0]?.count) || 0;
  }

  async markRead(userId, notificationId) {
    const user = positiveInt(userId, 'userId');
    const id = positiveInt(notificationId, 'notificationId');
    const result = await pool.query(
      `UPDATE notifications
       SET read_at = COALESCE(read_at, NOW())
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [id, user]
    );
    if (result.rows.length === 0) {
      throw new NotFoundError('Notification not found');
    }
    return result.rows[0];
  }

  async markAllRead(userId) {
    const id = positiveInt(userId, 'userId');
    const result = await pool.query(
      `UPDATE notifications
       SET read_at = NOW()
       WHERE user_id = $1 AND read_at IS NULL
       RETURNING id`,
      [id]
    );
    return result.rows.length;
  }

  /** Mark the answering user's question notification read (best effort). */
  async markQuestionRead(userId, questionId, { client = null } = {}) {
    const user = positiveInt(userId, 'userId');
    const question = positiveInt(questionId, 'questionId');
    const db = client || pool;
    const result = await db.query(
      `UPDATE notifications
       SET read_at = COALESCE(read_at, NOW())
       WHERE user_id = $1 AND question_id = $2 AND read_at IS NULL
       RETURNING id`,
      [user, question]
    );
    return result.rows.length;
  }
}

module.exports = new NotificationService();
module.exports.NotificationService = NotificationService;
module.exports.NOTIFICATION_TYPES = TYPES;
