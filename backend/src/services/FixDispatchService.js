const { pool } = require('../db');
const FixRequestService = require('./FixRequestService');
const {
  NotFoundError,
  ValidationError,
  ConflictError,
} = require('../errors/HttpError');
const logger = require('../utils/logger');

/**
 * fg-32c2b: fix-loop dispatch.
 *
 * `FIX_LOOP_MODE` (off|manual|auto) is the deployment default;
 * `projects.fix_loop_mode` overrides it. The mode decides **who may create a
 * fix request**, not which worker runs (that is `AGENT_MODE=fix`):
 *
 * - `off`: no queue. The manual phase transition keeps its pre-fg-32
 *   behaviour and no request is created.
 * - `manual`: humans create requests (phase transition or the JWT route).
 * - `auto`: reviewer agents may create requests after `request_changes`.
 */

const MODES = Object.freeze(['off', 'manual', 'auto']);
const ENV_KEY = 'FIX_LOOP_MODE';
let warnedInvalidEnv = false;

function envMode() {
  const raw = process.env[ENV_KEY];
  if (raw == null || raw.trim() === '') return 'off';
  const value = raw.trim().toLowerCase();
  if (!MODES.includes(value)) {
    if (!warnedInvalidEnv) {
      warnedInvalidEnv = true;
      // Fail closed: an unknown mode must not enable the fix loop.
      logger.warn(`Ignoring invalid ${ENV_KEY}='${raw}'; using 'off'`);
    }
    return 'off';
  }
  return value;
}

function resolveModeValue(projectMode) {
  const value = projectMode == null ? '' : String(projectMode).trim().toLowerCase();
  if (value !== '' && MODES.includes(value)) return value;
  return envMode();
}

/** `metadata.reason` and `metadata.feedback` both normalise to `feedback`. */
function feedbackFromMetadata(metadata) {
  if (metadata == null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  for (const key of ['feedback', 'reason']) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

function ticketId(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError('ticketId must be a positive integer');
  }
  return parsed;
}

class FixDispatchService {
  /**
   * Refuse a request the current mode does not allow.
   *
   * @param {'human'|'reviewer'} source who is creating the request
   * @returns {Promise<'off'|'manual'|'auto'>} the resolved mode
   */
  async assertCanCreate(ticketIdValue, source, { db = pool } = {}) {
    if (source !== 'human' && source !== 'reviewer') {
      throw new ValidationError('source must be human or reviewer');
    }
    const id = ticketId(ticketIdValue);
    const result = await db.query(
      `SELECT p.fix_loop_mode
         FROM tickets t
         JOIN projects p ON p.id = t.project_id
        WHERE t.id = $1
          AND t.deleted_at IS NULL
          AND p.deleted_at IS NULL`,
      [id]
    );
    if (result.rows.length === 0) {
      throw new NotFoundError('Ticket not found');
    }
    const mode = resolveModeValue(result.rows[0].fix_loop_mode);
    if (mode === 'off') {
      throw new ConflictError('Fix loop is disabled for this project');
    }
    if (source === 'reviewer' && mode !== 'auto') {
      throw new ConflictError('Automatic fix dispatch requires FIX_LOOP_MODE=auto');
    }
    return mode;
  }

  /**
   * Preflight for a human phase transition into `in_progress`.
   *
   * Runs before the caller opens its transaction so the branch/provider
   * resolution never happens while the ticket row is locked. Returns `null`
   * when the transition is not a manual fix dispatch or the mode is `off`
   * (the caller then keeps its normal transition).
   */
  async prepareManual(ticketIdValue, { toPhase, actorType, metadata } = {}) {
    if (toPhase !== 'in_progress' || actorType !== 'human') return null;
    const feedback = feedbackFromMetadata(metadata);
    if (!feedback) return null;

    const id = ticketId(ticketIdValue);
    const result = await pool.query(
      `SELECT t.phase, p.fix_loop_mode
         FROM tickets t
         JOIN projects p ON p.id = t.project_id
        WHERE t.id = $1
          AND t.deleted_at IS NULL
          AND p.deleted_at IS NULL`,
      [id]
    );
    const row = result.rows[0];
    if (!row || row.phase !== 'review') return null;
    if (resolveModeValue(row.fix_loop_mode) === 'off') return null;

    const preResolved = await FixRequestService.preResolve(id, { feedback });
    if (preResolved.existing) {
      // Idempotent retry: an active request already exists, so the caller
      // only needs to move the ticket.
      return { feedback, existing: preResolved.existing };
    }
    return { feedback, branchResolution: preResolved.branchResolution };
  }
}

const service = new FixDispatchService();
module.exports = service;
module.exports.FixDispatchService = FixDispatchService;
module.exports.resolveModeValue = resolveModeValue;
module.exports.feedbackFromMetadata = feedbackFromMetadata;
