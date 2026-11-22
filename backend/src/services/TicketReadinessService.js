const crypto = require('crypto');
const { pool } = require('../db');
const logger = require('../utils/logger');
const TemplateService = require('./TemplateService');
const ProjectAccessService = require('./ProjectAccessService');
const ReadinessEvaluator = require('./ReadinessEvaluator');
const ReadinessMetrics = require('./ReadinessMetrics');
const {
  ReadinessError,
  ValidationError,
  NotFoundError,
  ForbiddenError,
} = require('../errors/HttpError');

const GATE_MODES = ['off', 'warn', 'enforce'];
const MAX_OVERRIDE_DAYS = 30;

function gateMode() {
  const configured = String(process.env.READINESS_GATE_MODE || 'warn').toLowerCase();
  return GATE_MODES.includes(configured) ? configured : 'warn';
}

function mapTicket(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status,
    phase: row.phase,
    priority: row.priority,
    templateSchema: row.template_schema || null,
    planningStatus: row.planning_status || 'not_started',
    planApprovedAt: row.plan_approved_at || null,
    planApprovedBy: row.plan_approved_by || null,
    readyAt: row.ready_at || null,
    readyBy: row.ready_by || null,
    smallFixAt: row.small_fix_at || null,
    smallFixBy: row.small_fix_by || null,
    smallFixReason: row.small_fix_reason || null,
    readinessOverrideAt: row.readiness_override_at || null,
    readinessOverrideBy: row.readiness_override_by || null,
    readinessOverrideReason: row.readiness_override_reason || null,
    readinessWaivedCodes: row.readiness_waived_codes || [],
    readinessOverrideExpiresAt: row.readiness_override_expires_at || null,
    readinessGrandfatheredAt: row.readiness_grandfathered_at || null,
    readinessRequirementIds: row.readiness_requirement_ids || [],
  };
}

function activeWaivedCodes(ticket, now = new Date()) {
  const codes = Array.isArray(ticket.readinessWaivedCodes) ? ticket.readinessWaivedCodes : [];
  if (codes.length === 0) return [];
  if (!ticket.readinessOverrideExpiresAt) return codes;
  const expires = new Date(ticket.readinessOverrideExpiresAt);
  return expires.getTime() > now.getTime() ? codes : [];
}

function actorShape(actor = {}) {
  if (actor.type === 'agent' || actor.agentId) {
    return {
      type: 'agent',
      userId: actor.userId ?? null,
      agentId: actor.agentId ?? null,
      role: actor.role ?? null,
    };
  }
  if (actor.type === 'system' || (!actor.userId && !actor.role)) {
    return { type: 'system', userId: null, agentId: null, role: actor.role ?? null };
  }
  return {
    type: 'user',
    userId: actor.userId ?? null,
    agentId: null,
    role: actor.role ?? null,
  };
}

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

class TicketReadinessService {
  constructor() {
    this.evaluator = ReadinessEvaluator;
    this.templates = TemplateService;
  }

  async loadContext(ticketId, db = pool) {
    const ticketResult = await db.query(
      'SELECT * FROM tickets WHERE id = $1 AND deleted_at IS NULL',
      [ticketId]
    );
    if (ticketResult.rows.length === 0) throw new NotFoundError('Ticket not found');

    const rows = await this._planningRows(ticketId, db);
    const files = {};
    for (const row of rows) files[row.file_key] = row.content;

    const criteriaResult = await db.query(
      'SELECT text FROM ticket_acceptance_criteria WHERE ticket_id = $1 ORDER BY position, created_at',
      [ticketId]
    );

    const ticket = mapTicket(ticketResult.rows[0]);
    const template = await this.resolveTemplate(ticket, db);

    return {
      ticket,
      files,
      criteria: criteriaResult.rows.map(row => row.text),
      template,
      smallFix: ticket.smallFixReason ? { at: ticket.smallFixAt, reason: ticket.smallFixReason } : null,
      waivedCodes: activeWaivedCodes(ticket),
    };
  }

  async _planningRows(ticketId, db) {
    const result = await db.query(
      `SELECT DISTINCT ON (file_key) file_key, content, version
         FROM ticket_planning
        WHERE ticket_id = $1
        ORDER BY file_key, version DESC`,
      [ticketId]
    );
    return result.rows;
  }

  async resolveTemplate(ticket, db = pool) {
    const name = ticket.templateSchema;
    if (!name) return null;

    const builtIn = this.templates.getTemplateDefinition(name);
    if (builtIn) return builtIn;

    const result = await db.query(
      'SELECT file_definitions FROM project_templates WHERE project_id = $1 AND name = $2',
      [ticket.projectId, name]
    );
    if (result.rows.length === 0) return null;

    const definitions = parseJson(result.rows[0].file_definitions, []);
    const files = (Array.isArray(definitions) ? definitions : []).map(file => ({
      key: file.key,
      title: file.title || file.key,
      required: file.required !== false,
      requiredSections: Array.isArray(file.requiredSections) ? file.requiredSections : [],
    }));
    return {
      name,
      files,
      custom: true,
      sectionsEnforced: files.some(file => file.requiredSections.length > 0),
    };
  }

  evaluateContext(context, now = new Date()) {
    return this.evaluator.evaluate({
      ticket: context.ticket,
      files: context.files,
      criteria: context.criteria,
      template: context.template,
      smallFix: context.smallFix,
      waivedCodes: context.waivedCodes,
      now,
    });
  }

  async evaluate(ticketId, { db = pool } = {}) {
    const context = await this.loadContext(ticketId, db);
    const result = this.evaluateContext(context);
    return {
      ...result,
      ticketId: context.ticket.id,
      projectId: context.ticket.projectId,
      overrideExpiresAt: context.ticket.readinessOverrideExpiresAt,
      smallFixReason: context.ticket.smallFixReason,
      grandfathered: Boolean(context.ticket.readinessGrandfatheredAt),
    };
  }

  async getReadiness(ticketId) {
    return this.evaluate(ticketId);
  }

  /**
   * The single execution gate. Evaluates inside the caller's transaction,
   * returns a blocked result in warn mode and throws in enforce mode.
   * Persistence of the blocked row is the caller's post-commit/rollback job.
   */
  async assertReadyForExecution(ticketId, { toStatus, toPhase, source = 'unknown', actor = {}, attemptId, db = pool } = {}) {
    const mode = gateMode();
    if (mode === 'off') return { ready: true, skipped: true, mode };

    const context = await this.loadContext(ticketId, db);
    if (context.ticket.readinessGrandfatheredAt) {
      return { ready: true, skipped: true, grandfathered: true, mode };
    }

    const result = this.evaluateContext(context);
    if (result.ready) {
      ReadinessMetrics.increment('tickets_ready_total');
      return { ...result, mode, ticketId: context.ticket.id };
    }

    const blocked = {
      ...result,
      ticketId: context.ticket.id,
      projectId: context.ticket.projectId,
      toStatus: toStatus ?? null,
      toPhase: toPhase ?? null,
      mode,
      blocked: true,
      attemptId: attemptId || crypto.randomUUID(),
      source,
      actor: actorShape(actor),
    };

    if (mode === 'enforce') {
      ReadinessMetrics.increment('tickets_blocked_by_readiness_total', { source });
      throw new ReadinessError(blocked);
    }

    ReadinessMetrics.increment('tickets_blocked_by_readiness_total', { source, mode: 'warn' });
    return blocked;
  }

  /**
   * Persist a blocked attempt exactly once, on a pooled connection outside the
   * caller's transaction. Best effort: the request result must not depend on
   * the audit write.
   */
  async emitBlocked(result) {
    if (!result || !result.blocked || !result.ticketId) return;
    const actor = actorShape(result.actor || {});
    try {
      await pool.query(
        `INSERT INTO ticket_readiness_events
           (ticket_id, action, attempt_id, actor_type, actor_user_id, actor_agent_id,
            actor_role, reason, waived_codes, before_state, after_state)
         VALUES ($1, 'blocked', $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (attempt_id) DO NOTHING`,
        [
          result.ticketId,
          result.attemptId,
          actor.type,
          actor.userId,
          actor.agentId,
          actor.role,
          result.source ? `Blocked by ${result.source}` : null,
          Array.isArray(result.waivedCodes) ? result.waivedCodes : [],
          JSON.stringify({ toStatus: result.toStatus, toPhase: result.toPhase, mode: result.mode }),
          JSON.stringify({ issues: (result.issues || []).map(issue => issue.code) }),
        ]
      );
      logger.warn(
        `[readiness] blocked ticket ${result.ticketId} (${result.source}) in ${result.mode} mode: ` +
        (result.issues || []).map(issue => issue.code).join(', ')
      );
    } catch (error) {
      logger.warn(`[readiness] could not persist blocked event for ticket ${result.ticketId}: ${error.message}`);
    }
  }

  async recordEvent(ticketId, action, actorInput, { reason, waivedCodes, expiresAt, before, after } = {}) {
    const actor = actorShape(actorInput || {});
    try {
      await pool.query(
        `INSERT INTO ticket_readiness_events
           (ticket_id, action, actor_type, actor_user_id, actor_agent_id, actor_role,
            reason, waived_codes, expires_at, before_state, after_state)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          ticketId,
          action,
          actor.type,
          actor.userId,
          actor.agentId,
          actor.role,
          reason || null,
          waivedCodes || [],
          expiresAt || null,
          before ? JSON.stringify(before) : null,
          after ? JSON.stringify(after) : null,
        ]
      );
    } catch (error) {
      logger.warn(`[readiness] could not write ${action} event for ticket ${ticketId}: ${error.message}`);
    }
  }

  async _lockedTicket(client, ticketId) {
    const result = await client.query(
      'SELECT * FROM tickets WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
      [ticketId]
    );
    if (result.rows.length === 0) throw new NotFoundError('Ticket not found');
    return result.rows[0];
  }

  async _assertMember(actor, projectId, db) {
    const userId = ProjectAccessService.actorUserId(actor);
    if (!userId) throw new ForbiddenError('Operator identity required');
    await ProjectAccessService.assertProjectMember(userId, projectId, { role: actor.role }, db);
  }

  blockingIssues(result, waivedCodes = []) {
    const waived = new Set(waivedCodes || []);
    return (result.allIssues || []).filter(issue => {
      if (issue.code === 'PLAN_NOT_APPROVED') return false;
      if (issue.waivable !== false && waived.has(issue.code)) return false;
      return true;
    });
  }

  async approvePlan(ticketId, actor = {}) {
    const client = await pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      const row = await this._lockedTicket(client, ticketId);
      await this._assertMember(actor, row.project_id, client);

      const context = await this.loadContext(ticketId, client);
      if (context.ticket.readinessGrandfatheredAt) {
        throw new ValidationError('Ticket is grandfathered; approval is not required');
      }
      const result = this.evaluateContext(context);
      const blocking = this.blockingIssues(result, context.waivedCodes);
      if (blocking.length > 0) {
        await client.query('ROLLBACK');
        throw new ReadinessError({
          ...result,
          issues: blocking,
          ticketId,
          source: 'approve_plan',
          blocked: true,
          attemptId: crypto.randomUUID(),
          actor: actorShape(actor),
        });
      }

      const requirementIds = (result.requirements || []).map(req => req.id);
      const userId = ProjectAccessService.actorUserId(actor);
      await client.query(
        `UPDATE tickets
            SET plan_approved_at = NOW(), plan_approved_by = $2,
                planning_status = 'completed',
                readiness_requirement_ids = $3,
                ready_at = NOW(), ready_by = $2,
                updated_at = NOW()
          WHERE id = $1`,
        [ticketId, userId, requirementIds]
      );
      await client.query('COMMIT');
      committed = true;

      await this.recordEvent(ticketId, 'approved', actor, {
        before: { planApproved: Boolean(context.ticket.planApprovedAt), ready: Boolean(context.ticket.readyAt) },
        after: { planApproved: true, ready: true, requirementIds },
      });
      ReadinessMetrics.increment('tickets_ready_total');
      return this.evaluate(ticketId);
    } catch (error) {
      if (!committed) await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async smallFix(ticketId, reason, actor = {}) {
    if (!reason || String(reason).trim().length < 10) {
      throw new ValidationError('A small-fix reason of at least 10 characters is required');
    }
    const client = await pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      const row = await this._lockedTicket(client, ticketId);
      await this._assertMember(actor, row.project_id, client);
      const userId = ProjectAccessService.actorUserId(actor);

      await client.query(
        `UPDATE tickets
            SET small_fix_at = NOW(), small_fix_by = $2, small_fix_reason = $3,
                updated_at = NOW()
          WHERE id = $1`,
        [ticketId, userId, String(reason).trim()]
      );
      await client.query('COMMIT');
      committed = true;
      await this.recordEvent(ticketId, 'small_fix', actor, { reason: String(reason).trim() });
      await this.refreshReadyState(ticketId, actor);
      return this.evaluate(ticketId);
    } catch (error) {
      if (!committed) await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async replan(ticketId, actor = {}) {
    const client = await pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      const row = await this._lockedTicket(client, ticketId);
      await this._assertMember(actor, row.project_id, client);

      await client.query(
        `UPDATE tickets
            SET plan_approved_at = NULL, plan_approved_by = NULL,
                ready_at = NULL, ready_by = NULL,
                readiness_requirement_ids = '{}',
                planning_status = 'in_progress',
                updated_at = NOW()
          WHERE id = $1`,
        [ticketId]
      );
      await client.query('COMMIT');
      committed = true;
      await this.recordEvent(ticketId, 'replan_started', actor, {
        before: { planApprovedAt: row.plan_approved_at, readyAt: row.ready_at },
        after: { planApprovedAt: null, readyAt: null, planningStatus: 'in_progress' },
      });
      return this.evaluate(ticketId);
    } catch (error) {
      if (!committed) await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async override(ticketId, { codes, reason, expiresAt }, actor = {}) {
    if (!Array.isArray(codes) || codes.length === 0) {
      throw new ValidationError('At least one issue code must be waived');
    }
    if (!reason || String(reason).trim().length < 10) {
      throw new ValidationError('An override reason of at least 10 characters is required');
    }
    if (!expiresAt) throw new ValidationError('An override expiry is required');
    const expiry = new Date(expiresAt);
    if (Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) {
      throw new ValidationError('Override expiry must be in the future');
    }
    const maxExpiry = Date.now() + MAX_OVERRIDE_DAYS * 24 * 60 * 60 * 1000;
    if (expiry.getTime() > maxExpiry) {
      throw new ValidationError(`Override expiry cannot exceed ${MAX_OVERRIDE_DAYS} days`);
    }

    const client = await pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      const row = await this._lockedTicket(client, ticketId);
      await this._assertMember(actor, row.project_id, client);
      const userId = ProjectAccessService.actorUserId(actor);

      await client.query(
        `UPDATE tickets
            SET readiness_override_at = NOW(), readiness_override_by = $2,
                readiness_override_reason = $3, readiness_waived_codes = $4,
                readiness_override_expires_at = $5, updated_at = NOW()
          WHERE id = $1`,
        [ticketId, userId, String(reason).trim(), codes, expiry.toISOString()]
      );
      await client.query('COMMIT');
      committed = true;
      await this.recordEvent(ticketId, 'override_granted', actor, {
        reason: String(reason).trim(),
        waivedCodes: codes,
        expiresAt: expiry.toISOString(),
      });
      await this.refreshReadyState(ticketId, actor);
      return this.evaluate(ticketId);
    } catch (error) {
      if (!committed) await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeOverride(ticketId, actor = {}) {
    const client = await pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      const row = await this._lockedTicket(client, ticketId);
      await this._assertMember(actor, row.project_id, client);

      await client.query(
        `UPDATE tickets
            SET readiness_override_at = NULL, readiness_override_by = NULL,
                readiness_override_reason = NULL, readiness_waived_codes = '{}',
                readiness_override_expires_at = NULL, updated_at = NOW()
          WHERE id = $1`,
        [ticketId]
      );
      await client.query('COMMIT');
      committed = true;
      await this.recordEvent(ticketId, 'override_revoked', actor, {
        waivedCodes: row.readiness_waived_codes || [],
      });
      await this.refreshReadyState(ticketId, actor);
      return this.evaluate(ticketId);
    } catch (error) {
      if (!committed) await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Recompute the cached ready_at. Called after every readiness-relevant write.
   * Failing content invalidates an existing approval; it never becomes ready
   * again without a human calling approve-plan.
   */
  async refreshReadyState(ticketId, actor = {}) {
    const context = await this.loadContext(ticketId);
    if (context.ticket.readinessGrandfatheredAt) return this.evaluateContext(context);

    const result = this.evaluateContext(context);
    const userId = ProjectAccessService.actorUserId(actor);
    try {
      if (result.ready) {
        await pool.query(
          `UPDATE tickets SET ready_at = NOW(), ready_by = $2, updated_at = NOW() WHERE id = $1`,
          [ticketId, userId]
        );
      } else if (context.ticket.planApprovedAt) {
        await pool.query(
          `UPDATE tickets
              SET plan_approved_at = NULL, plan_approved_by = NULL,
                  ready_at = NULL, ready_by = NULL,
                  planning_status = 'in_progress', updated_at = NOW()
            WHERE id = $1`,
          [ticketId]
        );
        await this.recordEvent(ticketId, 'approval_invalidated', { type: 'system', role: 'system' }, {
          before: { planApprovedAt: context.ticket.planApprovedAt, readyAt: context.ticket.readyAt },
          after: { planApprovedAt: null, readyAt: null, issues: result.issues.map(issue => issue.code) },
        });
      } else {
        await pool.query(
          'UPDATE tickets SET ready_at = NULL, ready_by = NULL, updated_at = NOW() WHERE id = $1',
          [ticketId]
        );
      }
    } catch (error) {
      logger.warn(`[readiness] could not refresh ready state for ticket ${ticketId}: ${error.message}`);
    }
    return result;
  }

  async sweepExpiredOverrides(now = new Date()) {
    const result = await pool.query(
      `SELECT id, readiness_waived_codes, readiness_override_expires_at
         FROM tickets
        WHERE readiness_override_expires_at IS NOT NULL
          AND readiness_override_expires_at <= $1
          AND readiness_grandfathered_at IS NULL`,
      [now]
    );

    let swept = 0;
    for (const row of result.rows) {
      const existing = await pool.query(
        `SELECT 1 FROM ticket_readiness_events
          WHERE ticket_id = $1 AND action = 'override_expired'
            AND expires_at = $2 LIMIT 1`,
        [row.id, row.readiness_override_expires_at]
      );
      if (existing.rows.length === 0) {
        await this.recordEvent(row.id, 'override_expired', { type: 'system', role: 'system' }, {
          waivedCodes: row.readiness_waived_codes || [],
          expiresAt: row.readiness_override_expires_at,
        });
      }
      await pool.query(
        `UPDATE tickets
            SET readiness_override_at = NULL, readiness_override_by = NULL,
                readiness_override_reason = NULL, readiness_waived_codes = '{}',
                readiness_override_expires_at = NULL, updated_at = NOW()
          WHERE id = $1`,
        [row.id]
      );
      await this.refreshReadyState(row.id, { type: 'system', role: 'system' });
      swept += 1;
    }
    return { swept };
  }

  // ---- Acceptance criteria -------------------------------------------------

  async listCriteria(ticketId) {
    const result = await pool.query(
      `SELECT id, ticket_id, position, text, created_at, created_by
         FROM ticket_acceptance_criteria
        WHERE ticket_id = $1
        ORDER BY position, created_at`,
      [ticketId]
    );
    return result.rows;
  }

  async addCriteria(ticketId, criteria, actor = {}) {
    const rows = Array.isArray(criteria) ? criteria : [criteria];
    const clean = rows
      .map(item => (typeof item === 'string' ? item : item?.text))
      .map(text => String(text || '').trim())
      .filter(Boolean);
    if (clean.length === 0) throw new ValidationError('At least one acceptance criterion is required');

    const ticketResult = await pool.query(
      'SELECT id FROM tickets WHERE id = $1 AND deleted_at IS NULL',
      [ticketId]
    );
    if (ticketResult.rows.length === 0) throw new NotFoundError('Ticket not found');

    const positionResult = await pool.query(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM ticket_acceptance_criteria WHERE ticket_id = $1',
      [ticketId]
    );
    let position = Number(positionResult.rows[0]?.next ?? 0);
    const userId = ProjectAccessService.actorUserId(actor);
    const inserted = [];
    for (const text of clean) {
      const result = await pool.query(
        `INSERT INTO ticket_acceptance_criteria (ticket_id, position, text, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id, ticket_id, position, text, created_at, created_by`,
        [ticketId, position, text, userId]
      );
      inserted.push(result.rows[0]);
      position += 1;
    }
    await this.refreshReadyState(ticketId, actor);
    return inserted;
  }

  async updateCriterion(ticketId, criterionId, { text }, actor = {}) {
    if (!text || !String(text).trim()) throw new ValidationError('Criterion text is required');
    const result = await pool.query(
      `UPDATE ticket_acceptance_criteria
          SET text = $3
        WHERE id = $2 AND ticket_id = $1
        RETURNING id, ticket_id, position, text, created_at, created_by`,
      [ticketId, criterionId, String(text).trim()]
    );
    if (result.rows.length === 0) throw new NotFoundError('Acceptance criterion not found');
    await this.refreshReadyState(ticketId, actor);
    return result.rows[0];
  }

  async deleteCriterion(ticketId, criterionId, actor = {}) {
    const result = await pool.query(
      'DELETE FROM ticket_acceptance_criteria WHERE id = $2 AND ticket_id = $1 RETURNING id',
      [ticketId, criterionId]
    );
    if (result.rows.length === 0) throw new NotFoundError('Acceptance criterion not found');
    await this.refreshReadyState(ticketId, actor);
    return { id: result.rows[0].id };
  }

  parseAcceptanceCriteria(content) {
    const section = ReadinessEvaluator.extractSection(content, 'Acceptance Criteria');
    if (!section) return [];
    return section
      .split(/\r?\n/)
      .map(line => line.trim())
      .map(line => line.replace(/^[-*]\s*(\[[ xX]\]\s*)?/, '').replace(/^\d+[.)]\s*/, '').trim())
      .filter(line => line.length > 0 && !line.startsWith('|'));
  }

  /**
   * Seed the criteria table from an applied specification when it is empty.
   * The table is authoritative afterwards.
   */
  async seedCriteriaFromPlanning(ticketId, files, actor = {}) {
    const existing = await pool.query(
      'SELECT 1 FROM ticket_acceptance_criteria WHERE ticket_id = $1 LIMIT 1',
      [ticketId]
    );
    if (existing.rows.length > 0) return [];
    const content = files?.['04_SPECIFICATION.md']
      || files?.['01_ARCHITECT_REQUIREMENT.md']
      || '';
    const criteria = this.parseAcceptanceCriteria(content);
    if (criteria.length === 0) return [];
    return this.addCriteria(ticketId, criteria, actor);
  }
}

module.exports = new TicketReadinessService();
module.exports.TicketReadinessService = TicketReadinessService;
module.exports.gateMode = gateMode;
module.exports.activeWaivedCodes = activeWaivedCodes;
