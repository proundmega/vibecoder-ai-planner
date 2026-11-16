const { pool } = require('../db');
const crypto = require('crypto');
const HarnessRunService = require('./HarnessRunService');
const HarnessMetrics = require('./HarnessMetrics');
const { redactPayload } = require('../utils/harnessRedaction');
const {
  ValidationError,
  NotFoundError,
  ForbiddenError,
} = require('../errors/HttpError');
const logger = require('../utils/logger');

/**
 * Append-only harness event store (fg-41 slice 1).
 *
 * Every event is validated, tenant-bound to its run, redacted again at ingest,
 * and appended with an idempotency key. Updates and deletes are rejected by a
 * database trigger; retention is the only delete path and explicitly opts in.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,4}$/;
const KNOWN_EVENT_TYPES = Object.freeze(new Set([
  'run.started',
  'step.changed',
  'prompt.sent',
  'tool.called',
  'file.edited',
  'verification.result',
  'diff.collected',
  'publish.started',
  'pr.opened',
  'review.result',
  'fix.requested',
  'budget.warning',
  'budget.breach',
  'run.failed',
  'run.succeeded',
  'routing.decided',
  'usage.recorded',
]));
const AUDIT_TYPES = Object.freeze(new Set([
  'audit.publish',
  'audit.review',
  'audit.merge',
  'audit.rollback',
]));
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_AUDIT_RETENTION_DAYS = 365;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

function requiredUuid(value, field) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new ValidationError(`${field} must be a UUID`);
  }
  return value;
}

function requiredType(value) {
  if (typeof value !== 'string' || !EVENT_TYPE_PATTERN.test(value)) {
    throw new ValidationError(
      'type must be a dotted lowercase event name such as run.started'
    );
  }
  if (value.length > 120) {
    throw new ValidationError('type is too long');
  }
  return value;
}

function positiveInt(value, field) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError(`${field} must be a positive integer`);
  }
  return parsed;
}

function limitValue(value) {
  if (value === undefined || value === null) return DEFAULT_LIMIT;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
    throw new ValidationError(`limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  return parsed;
}

function retentionDays(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3650) {
    throw new ValidationError('retention days must be an integer between 1 and 3650');
  }
  return parsed;
}

async function loadRun(runId) {
  const result = await pool.query(
    `SELECT r.id, r.ticket_id, r.project_id, r.agent_id, r.session_id,
            t.project_id AS ticket_project_id
     FROM harness_runs r
     JOIN tickets t ON t.id = r.ticket_id
     WHERE r.id = $1`,
    [runId]
  );
  if (result.rows.length === 0) {
    throw new NotFoundError('Harness run not found');
  }
  return result.rows[0];
}

function normalisePayload(payload) {
  if (payload === undefined || payload === null) {
    return {};
  }
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ValidationError('payload must be a JSON object');
  }
  return payload;
}

class HarnessEventService {
  /**
   * Append one event. If the event id already exists the stored row is
   * returned and nothing is rewritten (idempotent emission).
   */
  async emit({
    eventId,
    traceId,
    runId,
    ticketId = null,
    projectId = null,
    agentId = null,
    sessionId = null,
    type,
    version = 1,
    timestamp = null,
    payload = {},
    requireRunOwnership = false,
  } = {}) {
    const id = requiredUuid(eventId, 'eventId');
    const trace = requiredUuid(traceId, 'traceId');
    const normalisedType = requiredType(type);
    const normalisedVersion = Number(version);
    if (!Number.isInteger(normalisedVersion) || normalisedVersion <= 0) {
      throw new ValidationError('version must be a positive integer');
    }

    let run = null;
    if (runId !== undefined && runId !== null && runId !== '') {
      run = await loadRun(requiredUuid(runId, 'runId'));
    } else if (requireRunOwnership) {
      throw new ValidationError('runId is required');
    }

    const resolvedTicketId = run
      ? Number(run.ticket_id)
      : (ticketId === null || ticketId === undefined ? null : positiveInt(ticketId, 'ticketId'));
    const resolvedProjectId = run
      ? Number(run.project_id || run.ticket_project_id)
      : (projectId === null || projectId === undefined
        ? null
        : positiveInt(projectId, 'projectId'));
    if (!resolvedProjectId) {
      throw new ValidationError('projectId is required when the event has no run');
    }
    if (requireRunOwnership && run
      && String(run.agent_id) !== String(agentId)) {
      throw new ForbiddenError('Harness run belongs to another agent');
    }
    const resolvedAgentId = run
      ? (run.agent_id === null ? null : Number(run.agent_id))
      : (agentId === null || agentId === undefined
        ? null
        : positiveInt(agentId, 'agentId'));
    const resolvedSessionId = run && run.session_id
      ? run.session_id
      : (sessionId || null);

    const normalisedPayloadInput = normalisePayload(payload);
    let eventTimestamp = new Date();
    if (timestamp !== null && timestamp !== undefined && timestamp !== '') {
      eventTimestamp = new Date(timestamp);
      if (Number.isNaN(eventTimestamp.getTime())) {
        throw new ValidationError('timestamp must be a valid timestamp');
      }
    }
    if (!normalisedPayloadInput._emitted_at) {
      normalisedPayloadInput._emitted_at = eventTimestamp.toISOString();
    }
    const safe = redactPayload(normalisedPayloadInput);

    const result = await pool.query(
      `INSERT INTO harness_events
         (event_id, trace_id, run_id, ticket_id, project_id, agent_id,
          session_id, type, version, payload, event_timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING *`,
      [
        id,
        trace,
        run ? run.id : null,
        resolvedTicketId,
        resolvedProjectId,
        resolvedAgentId,
        resolvedSessionId,
        normalisedType,
        normalisedVersion,
        JSON.stringify(safe.payload),
        eventTimestamp.toISOString(),
      ]
    );

    if (result.rows.length > 0) {
      HarnessMetrics.recordEvent(normalisedType, {
        secretFlagged: safe.secretFlagged,
      });
      return { event: result.rows[0], duplicate: false, redaction: safe };
    }

    const existing = await pool.query(
      'SELECT * FROM harness_events WHERE event_id = $1',
      [id]
    );
    if (existing.rows.length === 0) {
      throw new NotFoundError('Event could not be stored');
    }
    HarnessMetrics.recordEvent(normalisedType, {
      secretFlagged: safe.secretFlagged,
      duplicate: true,
    });
    return { event: existing.rows[0], duplicate: true, redaction: safe };
  }

  async getEvent(eventId) {
    const id = requiredUuid(eventId, 'eventId');
    const result = await pool.query(
      'SELECT * FROM harness_events WHERE event_id = $1',
      [id]
    );
    if (result.rows.length === 0) {
      throw new NotFoundError('Harness event not found');
    }
    return result.rows[0];
  }

  async listForRun(runId, { limit, before } = {}) {
    const id = requiredUuid(runId, 'runId');
    const max = limitValue(limit);
    const params = [id, max];
    let cursor = '';
    if (before !== undefined && before !== null && before !== '') {
      const beforeDate = new Date(before);
      if (Number.isNaN(beforeDate.getTime())) {
        throw new ValidationError('before must be a timestamp');
      }
      params.push(beforeDate.toISOString());
      cursor = 'AND event_timestamp < $3';
    }
    const result = await pool.query(
      `SELECT * FROM harness_events
       WHERE run_id = $1 ${cursor}
       ORDER BY event_timestamp ASC, created_at ASC, event_id ASC
       LIMIT $2`,
      params
    );
    return result.rows;
  }

  async listForProject(projectId, { type, since, until, limit, offset = 0 } = {}) {
    const id = positiveInt(projectId, 'projectId');
    const max = limitValue(limit);
    const parsedOffset = Number(offset);
    if (!Number.isInteger(parsedOffset) || parsedOffset < 0) {
      throw new ValidationError('offset must be a non-negative integer');
    }
    const params = [id];
    const clauses = ['project_id = $1'];
    if (type) {
      params.push(requiredType(type));
      clauses.push(`type = $${params.length}`);
    }
    if (since) {
      const date = new Date(since);
      if (Number.isNaN(date.getTime())) throw new ValidationError('since must be a timestamp');
      params.push(date.toISOString());
      clauses.push(`event_timestamp >= $${params.length}`);
    }
    if (until) {
      const date = new Date(until);
      if (Number.isNaN(date.getTime())) throw new ValidationError('until must be a timestamp');
      params.push(date.toISOString());
      clauses.push(`event_timestamp <= $${params.length}`);
    }
    params.push(max, parsedOffset);
    const result = await pool.query(
      `SELECT * FROM harness_events
       WHERE ${clauses.join(' AND ')}
       ORDER BY event_timestamp DESC, created_at DESC, event_id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return result.rows;
  }

  async listAudit(projectId, { since, until, limit, offset = 0 } = {}) {
    const id = positiveInt(projectId, 'projectId');
    const max = limitValue(limit);
    const parsedOffset = Number(offset);
    if (!Number.isInteger(parsedOffset) || parsedOffset < 0) {
      throw new ValidationError('offset must be a non-negative integer');
    }
    const params = [id];
    const clauses = ["project_id = $1", "type LIKE 'audit.%'"];
    if (since) {
      const date = new Date(since);
      if (Number.isNaN(date.getTime())) throw new ValidationError('since must be a timestamp');
      params.push(date.toISOString());
      clauses.push(`event_timestamp >= $${params.length}`);
    }
    if (until) {
      const date = new Date(until);
      if (Number.isNaN(date.getTime())) throw new ValidationError('until must be a timestamp');
      params.push(date.toISOString());
      clauses.push(`event_timestamp <= $${params.length}`);
    }
    params.push(max, parsedOffset);
    const result = await pool.query(
      `SELECT * FROM harness_events
       WHERE ${clauses.join(' AND ')}
       ORDER BY event_timestamp DESC, created_at DESC, event_id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return result.rows;
  }

  /**
   * Build the replay payload for a run: the ordered timeline, checkpoints,
   * artifacts referenced by events, and the commands needed to re-run
   * verification without the model. This is read-only; replay itself never
   * mutates the original run.
   */
  async getTimeline(runId) {
    const id = requiredUuid(runId, 'runId');
    const [run, checkpoints, events] = await Promise.all([
      HarnessRunService.getRun(id),
      HarnessRunService.getCheckpoints(id),
      this.listForRun(id, { limit: MAX_LIMIT }),
    ]);

    const artifacts = [];
    const verificationCommands = [];
    let diff = null;
    let prompt = null;
    for (const event of events) {
      const payload = event.payload || {};
      if (event.type === 'verification.result') {
        const command = payload.command || payload.cmd;
        if (command) verificationCommands.push(command);
        artifacts.push({
          kind: 'verification',
          eventId: event.event_id,
          command: command || null,
          exitCode: payload.exitCode ?? payload.exit_code ?? null,
          timedOut: Boolean(payload.timedOut || payload.timed_out),
        });
      } else if (event.type === 'diff.collected') {
        diff = payload;
        artifacts.push({
          kind: 'diff',
          eventId: event.event_id,
          sha256: payload.sha256 || null,
          changedFiles: payload.changedFiles ?? payload.changed_files ?? null,
          changedBytes: payload.changedBytes ?? payload.changed_bytes ?? null,
        });
      } else if (event.type === 'prompt.sent') {
        prompt = payload;
      }
    }

    return {
      run,
      traceId: events.length > 0 ? events[0].trace_id : null,
      events,
      checkpoints,
      artifacts,
      verificationCommands: Array.from(new Set(verificationCommands)),
      diff,
      promptSummary: prompt,
      replayable: Boolean(run && run.status !== 'running'),
    };
  }

  /**
   * Ensure a terminal event exists for a run. The supervisor normally emits it
   * before finishing, but a lost event must not leave a timeline that never
   * ends. Repeated finishes are deduplicated by (run_id, type).
   */
  async ensureTerminalEvent({ runId, status, error = null, headSha = null, prUrl = null } = {}) {
    const id = requiredUuid(runId, 'runId');
    const type = status === 'succeeded' ? 'run.succeeded' : 'run.failed';
    const existing = await pool.query(
      'SELECT * FROM harness_events WHERE run_id = $1 AND type = $2 ORDER BY event_timestamp ASC LIMIT 1',
      [id, type]
    );
    if (existing.rows.length > 0) {
      return existing.rows[0];
    }
    const trace = await pool.query(
      `SELECT trace_id FROM harness_events WHERE run_id = $1
       ORDER BY event_timestamp ASC LIMIT 1`,
      [id]
    );
    const traceId = trace.rows[0]?.trace_id || crypto.randomUUID();
    const run = await loadRun(id);
    const { event } = await this.emit({
      eventId: crypto.randomUUID(),
      traceId,
      runId: id,
      agentId: run.agent_id,
      type,
      payload: {
        status,
        error,
        headSha,
        prUrl,
        synthetic: true,
      },
    });
    return event;
  }

  /**
   * Delete events past their retention window. Audit events keep a longer
   * window. The transaction opts in to the append-only trigger's purge guard.
   */
  async purgeExpired({ eventDays, auditDays } = {}) {
    const normalDays = retentionDays(eventDays, DEFAULT_RETENTION_DAYS);
    const auditRetention = retentionDays(auditDays, DEFAULT_AUDIT_RETENTION_DAYS);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL harness.allow_event_purge = 'on'");
      const normal = await client.query(
        `DELETE FROM harness_events
         WHERE type NOT LIKE 'audit.%'
           AND created_at < NOW() - ($1::int * INTERVAL '1 day')`,
        [normalDays]
      );
      const audit = await client.query(
        `DELETE FROM harness_events
         WHERE type LIKE 'audit.%'
           AND created_at < NOW() - ($1::int * INTERVAL '1 day')`,
        [auditRetention]
      );
      await client.query('COMMIT');
      const purged = (normal.rowCount || 0) + (audit.rowCount || 0);
      HarnessMetrics.recordEventsPurged(purged);
      return { events: normal.rowCount || 0, audit: audit.rowCount || 0, total: purged };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error(`Harness event retention failed: ${error.message}`);
      throw error;
    } finally {
      client.release();
    }
  }

  isKnownType(type) {
    return KNOWN_EVENT_TYPES.has(type);
  }

  isAuditType(type) {
    return AUDIT_TYPES.has(type);
  }
}

const instance = new HarnessEventService();
module.exports = instance;
module.exports.HarnessEventService = HarnessEventService;
module.exports.UUID_PATTERN = UUID_PATTERN;
module.exports.KNOWN_EVENT_TYPES = KNOWN_EVENT_TYPES;
module.exports.AUDIT_TYPES = AUDIT_TYPES;
module.exports.DEFAULT_RETENTION_DAYS = DEFAULT_RETENTION_DAYS;
module.exports.DEFAULT_AUDIT_RETENTION_DAYS = DEFAULT_AUDIT_RETENTION_DAYS;
