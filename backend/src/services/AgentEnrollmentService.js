const net = require('net');
const crypto = require('crypto');
const { pool } = require('../db');
const AgentTokenService = require('./AgentTokenService');
const { encrypt, decrypt } = require('../utils/crypto');
const {
  enrollmentCounter,
  refreshCounter,
  enrollmentDuration,
  refreshDuration,
} = require('./AgentEnrollmentMetrics');

class EnrollmentError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'EnrollmentError';
    this.status = status;
    this.code = code;
  }
}

function intEnv(name, fallback) {
  const parsed = parseInt(process.env[name], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function inviteTtlSeconds() {
  return intEnv('AGENT_ENROLLMENT_TOKEN_TTL_SECONDS', 900);
}

function accessTtlSeconds() {
  return intEnv('AGENT_ACCESS_TOKEN_TTL_SECONDS', 3600);
}

function refreshTtlDays() {
  return intEnv('AGENT_REFRESH_TOKEN_TTL_DAYS', 30);
}

function replayCacheSeconds() {
  return intEnv('AGENT_REFRESH_REPLAY_CACHE_SECONDS', 60);
}

function safeIp(value) {
  if (typeof value !== 'string' || net.isIP(value) === 0) return null;
  return value;
}

function enrollmentError(code, message = 'Invalid enrollment token') {
  return new EnrollmentError(401, code, message);
}

class AgentEnrollmentService {
  static EnrollmentError = EnrollmentError;

  static get inviteTtlSeconds() { return inviteTtlSeconds(); }
  static get accessTtlSeconds() { return accessTtlSeconds(); }
  static get refreshTtlDays() { return refreshTtlDays(); }

  async audit(db, {
    projectId = null,
    agentId = null,
    eventType,
    actorType = 'system',
    actorId = null,
    ip = null,
    metadata = {},
  }) {
    await db.query(
      `INSERT INTO agent_auth_events
         (project_id, agent_id, event_type, actor_type, actor_id, ip_address, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [projectId, agentId, eventType, actorType, actorId, safeIp(ip), JSON.stringify(metadata)]
    );
  }

  async issueCredentialPair(db, agentId, familyId = crypto.randomUUID()) {
    const accessToken = AgentTokenService.generate('access');
    const refreshToken = AgentTokenService.generate('refresh');
    const accessExpiresAt = new Date(Date.now() + accessTtlSeconds() * 1000);
    const refreshExpiresAt = new Date(Date.now() + refreshTtlDays() * 24 * 60 * 60 * 1000);

    await db.query(
      `INSERT INTO agent_access_tokens (agent_id, token_prefix, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [agentId, AgentTokenService.lookupPrefix(accessToken), AgentTokenService.hash(accessToken), accessExpiresAt]
    );
    const refresh = await db.query(
      `INSERT INTO agent_refresh_tokens (agent_id, token_prefix, token_hash, family_id, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        agentId,
        AgentTokenService.lookupPrefix(refreshToken),
        AgentTokenService.hash(refreshToken),
        familyId,
        refreshExpiresAt,
      ]
    );

    return {
      accessToken,
      refreshToken,
      accessExpiresAt,
      refreshExpiresAt,
      refreshTokenId: refresh.rows[0] ? refresh.rows[0].id : null,
      familyId,
    };
  }

  /**
   * Mint a one-time, project-scoped join token. The raw value is returned
   * exactly once; only its hash and lookup prefix are persisted.
   */
  async mint({ projectId, name, ttlSeconds, maxUses, providerId = null, createdBy = null }) {
    if (providerId) {
      const provider = await pool.query('SELECT id FROM providers WHERE id = $1', [providerId]);
      if (provider.rows.length === 0) {
        throw new EnrollmentError(404, 'PROVIDER_NOT_FOUND', 'Provider not found');
      }
    }

    const rawToken = AgentTokenService.generate('enrollment');
    const ttl = ttlSeconds || inviteTtlSeconds();
    const uses = maxUses || 1;
    const expiresAt = new Date(Date.now() + ttl * 1000);

    const result = await pool.query(
      `INSERT INTO agent_enrollment_tokens
         (project_id, provider_id, name, token_prefix, token_hash, max_uses, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, project_id, provider_id, name, max_uses, used_count, expires_at, created_at`,
      [
        projectId,
        providerId || null,
        name,
        AgentTokenService.lookupPrefix(rawToken),
        AgentTokenService.hash(rawToken),
        uses,
        expiresAt,
        createdBy,
      ]
    );

    await this.audit(pool, {
      projectId,
      eventType: 'enrollment.minted',
      actorType: 'user',
      actorId: createdBy != null ? String(createdBy) : null,
      metadata: { enrollment_token_id: result.rows[0].id, max_uses: uses, ttl_seconds: ttl },
    });

    return { ...result.rows[0], token: rawToken };
  }

  async list(projectId) {
    const result = await pool.query(
      `SELECT id, project_id, provider_id, name, max_uses, used_count, expires_at,
              revoked_at, created_at
       FROM agent_enrollment_tokens
       WHERE project_id = $1
       ORDER BY created_at DESC`,
      [projectId]
    );
    return result.rows;
  }

  async revoke(id) {
    const result = await pool.query(
      `UPDATE agent_enrollment_tokens
       SET revoked_at = NOW()
       WHERE id = $1 AND revoked_at IS NULL
       RETURNING id, project_id, revoked_at`,
      [id]
    );
    if (result.rows.length === 0) return null;
    await this.audit(pool, {
      projectId: result.rows[0].project_id,
      eventType: 'enrollment.revoked',
      metadata: { enrollment_token_id: id },
    });
    return result.rows[0];
  }

  /**
   * Exchange a join token for an agent record plus an access/refresh pair.
   * Runs in a single transaction with a row lock so concurrent use of a
   * single-use token cannot create two agents.
   */
  async enroll({ token, name, nodeMetadata = {}, ip = null }) {
    if (AgentTokenService.kindOf(token) !== 'enrollment') {
      throw enrollmentError('ENROLLMENT_TOKEN_INVALID');
    }

    const endTimer = enrollmentDuration.startTimer();
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const found = await db.query(
        'SELECT * FROM agent_enrollment_tokens WHERE token_prefix = $1 FOR UPDATE',
        [AgentTokenService.lookupPrefix(token)]
      );
      const row = found.rows.find(candidate => AgentTokenService.matches(token, candidate.token_hash));

      if (!row || row.revoked_at) {
        throw enrollmentError('ENROLLMENT_TOKEN_INVALID');
      }
      if (new Date(row.expires_at) <= new Date()) {
        throw enrollmentError('ENROLLMENT_TOKEN_EXPIRED');
      }
      if (row.used_count >= row.max_uses) {
        throw enrollmentError('ENROLLMENT_TOKEN_EXHAUSTED');
      }

      const project = await db.query('SELECT id, owner_id FROM projects WHERE id = $1', [row.project_id]);
      if (project.rows.length === 0 || project.rows[0].owner_id == null) {
        throw enrollmentError('ENROLLMENT_TOKEN_INVALID');
      }

      const agent = await db.query(
        `INSERT INTO agents
           (name, owner_id, project_id, provider_id, enrollment_token_id,
            enrolled_at, node_metadata, last_enrolled_ip)
         VALUES ($1, $2, $3, $4, $5, NOW(), $6::jsonb, $7)
         RETURNING id, name, project_id, provider_id, created_at`,
        [
          name,
          project.rows[0].owner_id,
          row.project_id,
          row.provider_id || null,
          row.id,
          JSON.stringify(nodeMetadata || {}),
          safeIp(ip),
        ]
      );

      await db.query(
        'UPDATE agent_enrollment_tokens SET used_count = used_count + 1 WHERE id = $1',
        [row.id]
      );

      const agentRow = agent.rows[0];
      const pair = await this.issueCredentialPair(db, agentRow.id);

      await this.audit(db, {
        projectId: row.project_id,
        agentId: agentRow.id,
        eventType: 'enrollment.succeeded',
        ip,
        metadata: { enrollment_token_id: row.id },
      });

      await db.query('COMMIT');
      enrollmentCounter.inc({ result: 'success' });

      return {
        agent_id: agentRow.id,
        agent_name: agentRow.name,
        project_id: agentRow.project_id,
        provider_id: row.provider_id || null,
        access_token: pair.accessToken,
        refresh_token: pair.refreshToken,
        access_expires_at: pair.accessExpiresAt,
        refresh_expires_at: pair.refreshExpiresAt,
      };
    } catch (error) {
      enrollmentCounter.inc({ result: 'failure' });
      await db.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      endTimer();
      db.release();
    }
  }

  async revokeFamily(db, agentId) {
    await db.query(
      'UPDATE agent_access_tokens SET revoked_at = NOW() WHERE agent_id = $1 AND revoked_at IS NULL',
      [agentId]
    );
    await db.query(
      'UPDATE agent_refresh_tokens SET revoked_at = NOW() WHERE agent_id = $1 AND revoked_at IS NULL',
      [agentId]
    );
  }

  /**
   * Rotate a refresh token. Reuse of an already rotated/revoked token revokes
   * every credential for the agent (the token family) and is audited.
   */
  async refresh({ token, idempotencyKey, ip = null }) {
    if (AgentTokenService.kindOf(token) !== 'refresh') {
      refreshCounter.inc({ result: 'invalid' });
      throw new EnrollmentError(401, 'REFRESH_TOKEN_INVALID', 'Invalid refresh token');
    }
    if (!idempotencyKey || String(idempotencyKey).trim() === '') {
      refreshCounter.inc({ result: 'invalid' });
      throw new EnrollmentError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'idempotency_key is required');
    }

    const endTimer = refreshDuration.startTimer();
    let counted = false;
    const count = result => {
      if (!counted) {
        counted = true;
        refreshCounter.inc({ result });
      }
    };
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const found = await db.query(
        'SELECT * FROM agent_refresh_tokens WHERE token_prefix = $1 FOR UPDATE',
        [AgentTokenService.lookupPrefix(token)]
      );
      const row = found.rows.find(candidate => AgentTokenService.matches(token, candidate.token_hash));

      if (!row) {
        count('invalid');
        throw new EnrollmentError(401, 'REFRESH_TOKEN_INVALID', 'Invalid refresh token');
      }

      if (row.revoked_at) {
        count('invalid');
        throw new EnrollmentError(401, 'REFRESH_TOKEN_INVALID', 'Invalid refresh token');
      }

      if (row.rotated_at) {
        // A retry of the same refresh request carries the same idempotency
        // key. Within the replay window we return the identical pair instead
        // of rotating again, so a lost response cannot lock the node out.
        const replay = await db.query(
          `SELECT response_ciphertext, expires_at
           FROM agent_refresh_replays
           WHERE refresh_token_id = $1 AND idempotency_key = $2`,
          [row.id, idempotencyKey]
        );
        const cached = replay.rows[0];
        if (cached && new Date(cached.expires_at) > new Date()) {
          const payload = JSON.parse(decrypt(cached.response_ciphertext));
          await this.audit(db, {
            agentId: row.agent_id,
            eventType: 'refresh.replay_cache_hit',
            ip,
            metadata: { refresh_token_id: row.id },
          });
          await db.query('COMMIT');
          count('replay_cache_hit');
          return payload;
        }

        // A rotated token replayed with a different or missing key is theft.
        await this.revokeFamily(db, row.agent_id);
        await this.audit(db, {
          agentId: row.agent_id,
          eventType: 'refresh.reused',
          ip,
          metadata: { refresh_token_id: row.id },
        });
        await db.query('COMMIT');
        count('reuse');
        throw new EnrollmentError(401, 'REFRESH_TOKEN_REUSED', 'Refresh token already used; re-enroll this node');
      }

      if (new Date(row.expires_at) <= new Date()) {
        count('invalid');
        throw new EnrollmentError(401, 'REFRESH_TOKEN_INVALID', 'Invalid refresh token');
      }

      const pair = await this.issueCredentialPair(db, row.agent_id, row.family_id);
      await db.query(
        'UPDATE agent_refresh_tokens SET rotated_at = NOW(), replaced_by_id = $1 WHERE id = $2',
        [pair.refreshTokenId, row.id]
      );

      const agent = await db.query('SELECT project_id FROM agents WHERE id = $1', [row.agent_id]);
      const payload = {
        agent_id: row.agent_id,
        project_id: agent.rows[0] ? agent.rows[0].project_id : null,
        access_token: pair.accessToken,
        refresh_token: pair.refreshToken,
        access_expires_at: pair.accessExpiresAt,
        refresh_expires_at: pair.refreshExpiresAt,
      };

      const replayExpiresAt = new Date(Date.now() + replayCacheSeconds() * 1000);
      await db.query(
        `INSERT INTO agent_refresh_replays
           (refresh_token_id, idempotency_key, response_ciphertext, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (refresh_token_id, idempotency_key)
         DO UPDATE SET response_ciphertext = EXCLUDED.response_ciphertext,
                       expires_at = EXCLUDED.expires_at`,
        [row.id, idempotencyKey, encrypt(JSON.stringify(payload)), replayExpiresAt]
      );

      await this.audit(db, {
        agentId: row.agent_id,
        eventType: 'refresh.rotated',
        ip,
        metadata: { refresh_token_id: row.id },
      });
      await db.query('COMMIT');
      count('rotated');
      return payload;
    } catch (error) {
      count('invalid');
      await db.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      endTimer();
      db.release();
    }
  }

  /**
   * Resolve an `at_` access token. Returns `{ status, agent }`; callers map
   * expired/revoked to 401 without leaking whether the prefix exists.
   */
  async authenticateAccessToken(rawToken) {
    if (AgentTokenService.kindOf(rawToken) !== 'access') {
      return { status: 'invalid', agent: null };
    }

    const result = await pool.query(
      `SELECT t.id AS token_id, t.token_hash, t.expires_at AS token_expires_at,
              t.revoked_at AS token_revoked_at, a.*
       FROM agent_access_tokens t
       JOIN agents a ON a.id = t.agent_id
       WHERE t.token_prefix = $1`,
      [AgentTokenService.lookupPrefix(rawToken)]
    );

    const row = result.rows.find(candidate => AgentTokenService.matches(rawToken, candidate.token_hash));
    if (!row) return { status: 'invalid', agent: null };
    if (row.token_revoked_at) return { status: 'revoked', agent: null };
    if (new Date(row.token_expires_at) <= new Date()) return { status: 'expired', agent: null };

    const agent = { ...row };
    delete agent.token_hash;
    delete agent.token_expires_at;
    delete agent.token_revoked_at;
    agent.id = row.id;

    await pool.query('UPDATE agent_access_tokens SET last_used_at = NOW() WHERE id = $1', [row.token_id])
      .catch(() => {});

    return { status: 'ok', agent };
  }

  async revokeAllForAgent(agentId) {
    await this.revokeFamily(pool, agentId);
    await this.audit(pool, {
      agentId,
      eventType: 'agent.credentials_revoked',
    });
  }

  async getEnrollmentMetadata(agentId) {
    const result = await pool.query(
      `SELECT a.id, a.name, a.project_id, a.enrolled_at, a.enrollment_token_id,
              a.node_metadata, a.last_enrolled_ip,
              CASE WHEN a.enrolled_at IS NULL THEN 'legacy' ELSE 'enrollment' END AS auth_mode
       FROM agents a
       WHERE a.id = $1`,
      [agentId]
    );
    return result.rows[0] || null;
  }
}

module.exports = new AgentEnrollmentService();
module.exports.EnrollmentError = EnrollmentError;
