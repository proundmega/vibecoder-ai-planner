const { pool } = require('../db');
const RepoProfileService = require('./RepoProfileService');
const { NotFoundError, ForbiddenError, ValidationError, ConflictError } = require('../errors/HttpError');
const { redactProfile, redactText, redactResult } = require('../utils/repoProfileRedaction');

const STALE_FLOOR_MINUTES = 60;
const STALE_BUFFER_MINUTES = 5;
const MAX_RESULT_BYTES = 1024 * 1024;

function staleMinutesFor(profile) {
  const configured = Number(profile && profile.max_round_minutes);
  const budget = Number.isFinite(configured) && configured > 0 ? configured : 45;
  return Math.max(STALE_FLOOR_MINUTES, budget) + STALE_BUFFER_MINUTES;
}

function format(row, options = {}) {
  return {
    id: row.id,
    project_id: row.project_id,
    profile_id: row.profile_id,
    profile_version: row.profile_version,
    profile: options.redact === false ? row.profile : redactProfile(row.profile),
    profile_hash: row.profile_hash,
    status: row.status,
    requested_by: row.requested_by,
    runtime_id: row.runtime_id,
    result: options.includeResult === false
      ? null
      : (options.redact === false ? row.result : redactResult(row.result)),
    error: row.error == null ? null : redactText(row.error),
    created_at: row.created_at,
    started_at: row.started_at,
    finished_at: row.finished_at,
  };
}

function normalizeResult(result) {
  if (result === undefined || result === null) return {};
  if (typeof result !== 'object' || Array.isArray(result)) {
    throw new ValidationError('result must be a JSON object');
  }
  const serialized = JSON.stringify(result);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RESULT_BYTES) {
    throw new ValidationError('result must be at most 1 MiB');
  }
  // Defense in depth: the agent redacts known service passwords and
  // credential formats before reporting, but the result crosses a process and
  // an HTTP boundary. Re-scan it at ingest so no caller can persist a
  // credential-shaped output.
  return redactResult(result);
}

class RepoProfileValidationService {
  async request(projectId, profileId, user) {
    await RepoProfileService.assertCanWrite(projectId, user);
    const profileResult = await pool.query(
      'SELECT * FROM repo_profiles WHERE id = $1 AND project_id = $2',
      [profileId, projectId]
    );
    if (profileResult.rows.length === 0) {
      throw new NotFoundError('Repo profile not found');
    }
    const profile = profileResult.rows[0];
    // Inactive rows that were never active are retired drafts. Keep them
    // inert: a new version must be created instead of validating stale content.
    if (profile.status === 'inactive' && !profile.activated_at) {
      throw new ValidationError(
        'Retired drafts cannot be validated; create a new version');
    }
    await RepoProfileService.assertProfileRepoBinding(projectId, profile.profile);
    const profileHash = profile.profile_hash
      || RepoProfileService.profileHash(profile.profile);
    if (!profile.profile_hash) {
      // Legacy rows from the earlier migration draft have no content hash.
      // Persist it only if it is still null: a concurrent edit must not have
      // its newer hash overwritten by this stale snapshot.
      const persisted = await pool.query(
        `UPDATE repo_profiles
         SET profile_hash = $1, updated_at = NOW()
         WHERE id = $2 AND project_id = $3 AND profile_hash IS NULL
         RETURNING profile_hash`,
        [profileHash, profileId, projectId]
      );
      if (persisted.rows.length === 0) {
        const latest = await pool.query(
          'SELECT profile_hash FROM repo_profiles WHERE id = $1 AND project_id = $2',
          [profileId, projectId]
        );
        if (!latest.rows[0] || latest.rows[0].profile_hash !== profileHash) {
          throw new ConflictError(
            'Repo profile changed while queuing validation; reload and retry');
        }
      }
    }
    try {
      const inserted = await pool.query(
        `INSERT INTO repo_profile_validations
           (project_id, profile_id, profile_version, profile, profile_hash,
            status, requested_by)
         VALUES ($1, $2, $3, $4, $5, 'queued', $6)
         RETURNING *`,
        [
          projectId,
          profileId,
          profile.version,
          JSON.stringify(profile.profile),
          profileHash,
          user.userId || user.id,
        ]
      );
      return format(inserted.rows[0]);
    } catch (error) {
      if (error.code === '23505') {
        throw new ConflictError('A validation is already queued or running for this profile');
      }
      throw error;
    }
  }

  async list(projectId, user, { limit = 200, offset = 0 } = {}) {
    const pageSize = Number(limit);
    const start = Number(offset);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
      throw new ValidationError('limit must be an integer between 1 and 200');
    }
    if (!Number.isInteger(start) || start < 0) {
      throw new ValidationError('offset must be a non-negative integer');
    }
    await RepoProfileService.assertCanRead(projectId, user);
    const includeResult = await RepoProfileService.canWrite(projectId, user);
    const result = await pool.query(
      `SELECT * FROM repo_profile_validations
       WHERE project_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [projectId, pageSize, start]
    );
    return result.rows.map((row) => format(row, { includeResult }));
  }

  async get(projectId, validationId, user) {
    await RepoProfileService.assertCanRead(projectId, user);
    const includeResult = await RepoProfileService.canWrite(projectId, user);
    const result = await pool.query(
      'SELECT * FROM repo_profile_validations WHERE id = $1 AND project_id = $2',
      [validationId, projectId]
    );
    if (result.rows.length === 0) {
      throw new NotFoundError('Repo profile validation not found');
    }
    return format(result.rows[0], { includeResult });
  }

  async claimNext(projectId, agent, runtimeId = null) {
    await RepoProfileService.assertAgentProjectAccess(projectId, agent);
    if (runtimeId === null || runtimeId === undefined) {
      throw new ValidationError('runtimeId is required');
    }
    const ownerRuntimeId = Number(runtimeId);
    if (!Number.isInteger(ownerRuntimeId) || ownerRuntimeId <= 0) {
      throw new ValidationError('runtimeId must be a positive integer');
    }

    const now = Date.now();
    const stale = await pool.query(
      `SELECT id, profile, started_at
       FROM repo_profile_validations
       WHERE project_id = $1 AND status = 'running'`,
      [projectId]
    );
    for (const row of stale.rows) {
      const minutes = staleMinutesFor(row.profile);
      const started = row.started_at ? new Date(row.started_at).getTime() : 0;
      if (started > 0 && now - started >= minutes * 60_000) {
        await pool.query(
          `UPDATE repo_profile_validations
           SET status = 'failed', error = $2, finished_at = NOW()
           WHERE id = $1 AND status = 'running'`,
          [row.id, `validation exceeded its ${minutes}-minute stale budget`]
        );
      }
    }

    const claimed = await pool.query(
      `WITH candidate AS (
         SELECT id
         FROM repo_profile_validations
         WHERE project_id = $1 AND status = 'queued'
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE repo_profile_validations v
       SET status = 'running', runtime_id = $2, started_at = NOW()
       FROM candidate c
       WHERE v.id = c.id
       RETURNING v.*`,
      [projectId, ownerRuntimeId]
    );
    return claimed.rows.length > 0 ? format(claimed.rows[0], { redact: false }) : null;
  }

  async finish(projectId, validationId, agent, payload = {}, runtimeId = null) {
    await RepoProfileService.assertAgentProjectAccess(projectId, agent);
    if (runtimeId === null || runtimeId === undefined) {
      throw new ValidationError('runtimeId is required');
    }
    const ownerRuntimeId = Number(runtimeId);
    if (!Number.isInteger(ownerRuntimeId) || ownerRuntimeId <= 0) {
      throw new ValidationError('runtimeId must be a positive integer');
    }
    const status = payload.status;
    if (status !== 'succeeded' && status !== 'failed') {
      throw new ValidationError("status must be 'succeeded' or 'failed'");
    }
    const result = normalizeResult(payload.result);
    const error = payload.error == null
      ? null
      : redactText(String(payload.error).slice(0, 4000));

    const existing = await pool.query(
      'SELECT * FROM repo_profile_validations WHERE id = $1 AND project_id = $2',
      [validationId, projectId]
    );
    if (existing.rows.length === 0) {
      throw new NotFoundError('Repo profile validation not found');
    }
    const row = existing.rows[0];
    if (row.status === 'succeeded' || row.status === 'failed') {
      // Retrying a finish after a lost response is safe and must not overwrite
      // the first terminal result.
      return format(row, { redact: false });
    }
    if (row.status !== 'running') {
      throw new ConflictError('Validation has not been claimed');
    }
    const ownsValidation = row.runtime_id != null
      && String(row.runtime_id) === String(ownerRuntimeId);
    if (!ownsValidation) {
      throw new ForbiddenError('Validation belongs to another runtime');
    }

    const updated = await pool.query(
      `UPDATE repo_profile_validations
       SET status = $1, result = $2, error = $3, finished_at = NOW()
       WHERE id = $4 AND project_id = $5 AND status = 'running' AND runtime_id = $6
       RETURNING *`,
      [status, JSON.stringify(result), error, validationId, projectId, ownerRuntimeId]
    );
    if (updated.rows.length === 0) {
      const raced = await pool.query(
        'SELECT * FROM repo_profile_validations WHERE id = $1 AND project_id = $2',
        [validationId, projectId]
      );
      if (raced.rows.length > 0) return format(raced.rows[0], { redact: false });
      throw new ConflictError('Validation is no longer running');
    }
    return format(updated.rows[0], { redact: false });
  }
}

module.exports = new RepoProfileValidationService();
module.exports.format = format;
module.exports.staleMinutesFor = staleMinutesFor;
