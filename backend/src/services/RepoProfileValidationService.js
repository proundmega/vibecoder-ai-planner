const { pool } = require('../db');
const RepoProfileService = require('./RepoProfileService');
const { NotFoundError, ForbiddenError, ValidationError, ConflictError } = require('../errors/HttpError');

const STALE_AFTER = '60 minutes';
const MAX_RESULT_BYTES = 1024 * 1024;

function format(row) {
  return {
    id: row.id,
    project_id: row.project_id,
    profile_id: row.profile_id,
    profile_version: row.profile_version,
    profile: row.profile,
    status: row.status,
    requested_by: row.requested_by,
    agent_id: row.agent_id,
    result: row.result,
    error: row.error,
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
  return result;
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
    try {
      const inserted = await pool.query(
        `INSERT INTO repo_profile_validations
           (project_id, profile_id, profile_version, profile, status, requested_by)
         VALUES ($1, $2, $3, $4, 'queued', $5)
         RETURNING *`,
        [
          projectId,
          profileId,
          profile.version,
          JSON.stringify(profile.profile),
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

  async list(projectId, user) {
    await RepoProfileService.assertCanRead(projectId, user);
    const result = await pool.query(
      `SELECT * FROM repo_profile_validations
       WHERE project_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [projectId]
    );
    return result.rows.map(format);
  }

  async get(projectId, validationId, user) {
    await RepoProfileService.assertCanRead(projectId, user);
    const result = await pool.query(
      'SELECT * FROM repo_profile_validations WHERE id = $1 AND project_id = $2',
      [validationId, projectId]
    );
    if (result.rows.length === 0) {
      throw new NotFoundError('Repo profile validation not found');
    }
    return format(result.rows[0]);
  }

  async claimNext(projectId, agent) {
    await RepoProfileService.assertAgentProjectAccess(projectId, agent);

    await pool.query(
      `UPDATE repo_profile_validations
       SET status = 'failed',
           error = 'validation timed out after 60 minutes',
           finished_at = NOW()
       WHERE project_id = $1
         AND status = 'running'
         AND started_at < NOW() - INTERVAL '${STALE_AFTER}'`,
      [projectId]
    );

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
       SET status = 'running', agent_id = $2, started_at = NOW()
       FROM candidate c
       WHERE v.id = c.id
       RETURNING v.*`,
      [projectId, agent.id]
    );
    return claimed.rows.length > 0 ? format(claimed.rows[0]) : null;
  }

  async finish(projectId, validationId, agent, payload = {}) {
    await RepoProfileService.assertAgentProjectAccess(projectId, agent);
    const status = payload.status;
    if (status !== 'succeeded' && status !== 'failed') {
      throw new ValidationError("status must be 'succeeded' or 'failed'");
    }
    const result = normalizeResult(payload.result);
    const error = payload.error == null ? null : String(payload.error).slice(0, 4000);

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
      return format(row);
    }
    if (row.status !== 'running') {
      throw new ConflictError('Validation has not been claimed');
    }
    if (String(row.agent_id) !== String(agent.id)) {
      throw new ForbiddenError('Validation belongs to another agent');
    }

    const updated = await pool.query(
      `UPDATE repo_profile_validations
       SET status = $1, result = $2, error = $3, finished_at = NOW()
       WHERE id = $4 AND project_id = $5 AND status = 'running' AND agent_id = $6
       RETURNING *`,
      [status, JSON.stringify(result), error, validationId, projectId, agent.id]
    );
    if (updated.rows.length === 0) {
      const raced = await pool.query(
        'SELECT * FROM repo_profile_validations WHERE id = $1 AND project_id = $2',
        [validationId, projectId]
      );
      if (raced.rows.length > 0) return format(raced.rows[0]);
      throw new ConflictError('Validation is no longer running');
    }
    return format(updated.rows[0]);
  }
}

module.exports = new RepoProfileValidationService();
module.exports.format = format;
