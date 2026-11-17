const crypto = require('crypto');
const { pool } = require('../db');
const HarnessEventService = require('./HarnessEventService');

/**
 * Immutable publish/review audit trail (fg-41 FR9).
 *
 * Audit records are ordinary rows in the append-only harness event store, so
 * they share its retention, tenant scope and update/delete trigger. Merge and
 * rollback recorders are defined for fg-36 but intentionally unused until that
 * ticket exists.
 */

const AUDIT_TYPES = Object.freeze(new Set([
  'audit.publish',
  'audit.review',
  'audit.merge',
  'audit.rollback',
  'audit.privacy',
]));

async function traceIdForRun(runId) {
  if (!runId) return crypto.randomUUID();
  const result = await pool.query(
    `SELECT trace_id FROM harness_events
     WHERE run_id = $1
     ORDER BY created_at ASC, event_id ASC
     LIMIT 1`,
    [runId]
  );
  return result.rows[0]?.trace_id || crypto.randomUUID();
}

class HarnessAuditService {
  async record({
    type,
    runId = null,
    projectId = null,
    ticketId = null,
    agentId = null,
    actorType = 'system',
    actorId = null,
    reason = null,
    beforeSha = null,
    afterSha = null,
    prUrl = null,
    dedupeKey = null,
    payload = {},
  } = {}) {
    if (!AUDIT_TYPES.has(type)) {
      throw new Error(`Unsupported audit type: ${type}`);
    }

    const eventId = crypto.randomUUID();
    const traceId = await traceIdForRun(runId);
    const auditPayload = {
      ...payload,
      actor: { type: actorType, id: actorId === null ? null : String(actorId) },
      reason: reason || null,
      beforeSha: beforeSha || null,
      afterSha: afterSha || null,
      prUrl: prUrl || null,
      dedupeKey: dedupeKey || null,
    };

    if (dedupeKey) {
      const existing = await pool.query(
        `SELECT * FROM harness_events
         WHERE type = $1
           AND (($2::uuid IS NOT NULL AND run_id = $2::uuid)
                OR ($2::uuid IS NULL AND project_id = $3))
           AND payload->>'dedupeKey' = $4
         LIMIT 1`,
        [type, runId, projectId, dedupeKey]
      );
      if (existing.rows.length > 0) {
        return existing.rows[0];
      }
    }

    const { event } = await HarnessEventService.emit({
      eventId,
      traceId,
      runId,
      ticketId,
      projectId,
      agentId,
      type,
      version: 1,
      payload: auditPayload,
    });
    return event;
  }

  async recordPublish({
    runId,
    projectId,
    ticketId,
    agentId,
    headSha,
    prUrl,
    actorType = 'agent',
    actorId = null,
    reason = 'publish evidence recorded',
  }) {
    return this.record({
      type: 'audit.publish',
      runId,
      projectId,
      ticketId,
      agentId,
      actorType,
      actorId,
      reason,
      afterSha: headSha,
      prUrl,
      dedupeKey: `publish:${headSha || ''}:${prUrl || ''}`,
    });
  }

  async recordReview({
    runId,
    projectId,
    ticketId,
    agentId,
    result = null,
    reason = null,
    eventId = null,
    actorType = 'agent',
    actorId = null,
  }) {
    return this.record({
      type: 'audit.review',
      runId,
      projectId,
      ticketId,
      agentId,
      actorType,
      actorId,
      reason: reason || result || 'review result recorded',
      dedupeKey: `review:${eventId || runId || projectId}:${result || ''}`,
      payload: { result },
    });
  }

  async recordMerge(options = {}) {
    return this.record({ ...options, type: 'audit.merge' });
  }

  async recordRollback(options = {}) {
    return this.record({ ...options, type: 'audit.rollback' });
  }

  async recordPrivacy({
    projectId,
    runId = null,
    ticketId = null,
    agentId = null,
    action = 'policy',
    reason = null,
    actorType = 'user',
    actorId = null,
    payload = {},
  } = {}) {
    return this.record({
      type: 'audit.privacy',
      projectId,
      runId,
      ticketId,
      agentId,
      actorType,
      actorId,
      reason,
      payload: { action, ...payload },
    });
  }
}

const instance = new HarnessAuditService();
module.exports = instance;
module.exports.HarnessAuditService = HarnessAuditService;
module.exports.AUDIT_TYPES = AUDIT_TYPES;
