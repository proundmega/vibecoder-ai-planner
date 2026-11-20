const crypto = require('crypto');
const net = require('net');
const { pool } = require('../db');
const AgentTokenService = require('./AgentTokenService');
const { encrypt, decrypt } = require('../utils/crypto');

const ROLES = ['worker', 'reviewer', 'planner'];
const EFFORTS = ['minimal', 'low', 'medium', 'high', 'max'];

class AgentNodeError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function intEnv(name, fallback) {
  const parsed = parseInt(process.env[name], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function accessTtlSeconds() {
  return intEnv('AGENT_ACCESS_TOKEN_TTL_SECONDS', 3600);
}

function refreshTtlDays() {
  return intEnv('AGENT_REFRESH_TOKEN_TTL_DAYS', 30);
}

function nodeTokenTtlSeconds() {
  return intEnv('AGENT_ENROLLMENT_TOKEN_TTL_SECONDS', 900);
}

function safeIp(value) {
  return typeof value === 'string' && net.isIP(value) !== 0 ? value : null;
}

function fail(status, code, message) {
  return new AgentNodeError(status, code, message);
}

async function audit(db, {
  nodeId = null,
  projectId = null,
  eventType,
  actorType = 'system',
  actorId = null,
  ip = null,
  metadata = {},
}) {
  await db.query(
    `INSERT INTO agent_node_auth_events
       (node_id, project_id, event_type, actor_type, actor_id, ip_address, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [nodeId, projectId, eventType, actorType, actorId, safeIp(ip), JSON.stringify(metadata)]
  );
}

async function issueCredentialPair(db, nodeId, familyId = crypto.randomUUID()) {
  const accessToken = AgentTokenService.generate('access');
  const refreshToken = AgentTokenService.generate('refresh');
  const accessExpiresAt = new Date(Date.now() + accessTtlSeconds() * 1000);
  const refreshExpiresAt = new Date(Date.now() + refreshTtlDays() * 24 * 60 * 60 * 1000);

  await db.query(
    `INSERT INTO agent_node_access_tokens (node_id, token_prefix, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [nodeId, AgentTokenService.lookupPrefix(accessToken), AgentTokenService.hash(accessToken), accessExpiresAt]
  );
  const refresh = await db.query(
    `INSERT INTO agent_node_refresh_tokens
       (node_id, token_prefix, token_hash, family_id, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      nodeId,
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

async function revokeFamily(db, nodeId) {
  await db.query(
    `UPDATE agent_node_access_tokens SET revoked_at = NOW()
     WHERE node_id = $1 AND revoked_at IS NULL`,
    [nodeId]
  );
  await db.query(
    `UPDATE agent_node_refresh_tokens SET revoked_at = NOW()
     WHERE node_id = $1 AND revoked_at IS NULL`,
    [nodeId]
  );
}

class AgentNodeService {
  static AgentNodeError = AgentNodeError;
  static ROLES = ROLES;
  static EFFORTS = EFFORTS;

  async mint({ ownerId, name, ttlSeconds, maxUses, createdBy = null, ip = null }) {
    if (!ownerId) throw fail(400, 'OWNER_REQUIRED', 'ownerId is required');
    if (!name || !String(name).trim()) throw fail(400, 'NAME_REQUIRED', 'name is required');
    const ttl = ttlSeconds || nodeTokenTtlSeconds();
    const uses = maxUses || 1;
    const token = AgentTokenService.generate('enrollment');
    const expiresAt = new Date(Date.now() + ttl * 1000);

    const result = await pool.query(
      `INSERT INTO agent_node_enrollment_tokens
         (owner_id, name, token_prefix, token_hash, max_uses, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, owner_id, name, max_uses, used_count, expires_at, created_at`,
      [
        ownerId,
        name,
        AgentTokenService.lookupPrefix(token),
        AgentTokenService.hash(token),
        uses,
        expiresAt,
        createdBy,
      ]
    );
    await audit(pool, {
      eventType: 'node.enrollment_token_minted',
      actorType: 'user',
      actorId: createdBy == null ? null : String(createdBy),
      ip,
      metadata: { enrollment_token_id: result.rows[0].id, max_uses: uses },
    });
    return { ...result.rows[0], token };
  }

  async enroll({ token, name, hostname = null, fingerprint = null, ip = null }) {
    if (AgentTokenService.kindOf(token) !== 'enrollment') {
      throw fail(401, 'ENROLLMENT_TOKEN_INVALID', 'Invalid enrollment token');
    }
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const found = await db.query(
        `SELECT * FROM agent_node_enrollment_tokens
         WHERE token_prefix = $1 FOR UPDATE`,
        [AgentTokenService.lookupPrefix(token)]
      );
      const row = found.rows.find((candidate) =>
        AgentTokenService.matches(token, candidate.token_hash)
      );
      if (!row || row.revoked_at) throw fail(401, 'ENROLLMENT_TOKEN_INVALID', 'Invalid enrollment token');
      if (new Date(row.expires_at) <= new Date()) {
        throw fail(401, 'ENROLLMENT_TOKEN_EXPIRED', 'Enrollment token expired');
      }
      if (row.used_count >= row.max_uses) {
        throw fail(409, 'ENROLLMENT_TOKEN_EXHAUSTED', 'Enrollment token already used');
      }
      if (!name || !String(name).trim()) throw fail(400, 'NAME_REQUIRED', 'name is required');

      const node = await db.query(
        `INSERT INTO agent_nodes (owner_id, name, hostname, fingerprint)
         VALUES ($1, $2, $3, $4)
         RETURNING id, owner_id, name, hostname, fingerprint, status, created_at`,
        [row.owner_id, name, hostname, fingerprint]
      );
      await db.query(
        'UPDATE agent_node_enrollment_tokens SET used_count = used_count + 1 WHERE id = $1',
        [row.id]
      );
      const pair = await issueCredentialPair(db, node.rows[0].id);
      await audit(db, {
        nodeId: node.rows[0].id,
        eventType: 'node.enrolled',
        ip,
        metadata: { enrollment_token_id: row.id },
      });
      await db.query('COMMIT');
      return {
        node: node.rows[0],
        access_token: pair.accessToken,
        refresh_token: pair.refreshToken,
        access_expires_at: pair.accessExpiresAt,
        refresh_expires_at: pair.refreshExpiresAt,
      };
    } catch (error) {
      await db.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      db.release();
    }
  }

  async authenticateAccessToken(rawToken) {
    if (AgentTokenService.kindOf(rawToken) !== 'access') {
      return { status: 'invalid', node: null };
    }
    const result = await pool.query(
      `SELECT t.id AS token_id, t.token_hash, t.expires_at AS token_expires_at,
              t.revoked_at AS token_revoked_at, n.*
       FROM agent_node_access_tokens t
       JOIN agent_nodes n ON n.id = t.node_id
       WHERE t.token_prefix = $1`,
      [AgentTokenService.lookupPrefix(rawToken)]
    );
    const row = result.rows.find((candidate) =>
      AgentTokenService.matches(rawToken, candidate.token_hash)
    );
    if (!row) return { status: 'invalid', node: null };
    if (row.token_revoked_at) return { status: 'revoked', node: null };
    if (new Date(row.token_expires_at) <= new Date()) return { status: 'expired', node: null };

    const node = { ...row };
    delete node.token_hash;
    delete node.token_expires_at;
    delete node.token_revoked_at;
    delete node.token_id;

    await pool
      .query('UPDATE agent_node_access_tokens SET last_used_at = NOW() WHERE id = $1', [row.token_id])
      .catch(() => {});

    return { status: 'ok', node };
  }

  async refresh({ token, idempotencyKey = null, ip = null }) {
    if (AgentTokenService.kindOf(token) !== 'refresh') {
      throw fail(401, 'REFRESH_TOKEN_INVALID', 'Invalid refresh token');
    }
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const initial = await db.query(
        'SELECT * FROM agent_node_refresh_tokens WHERE token_prefix = $1',
        [AgentTokenService.lookupPrefix(token)]
      );
      let row = initial.rows.find((candidate) =>
        AgentTokenService.matches(token, candidate.token_hash)
      );
      if (!row) throw fail(401, 'REFRESH_TOKEN_INVALID', 'Invalid refresh token');

      const lockedNode = await db.query(
        'SELECT id FROM agent_nodes WHERE id = $1 FOR UPDATE',
        [row.node_id]
      );
      if (lockedNode.rows.length === 0) {
        throw fail(401, 'REFRESH_TOKEN_INVALID', 'Invalid refresh token');
      }

      const locked = await db.query(
        'SELECT * FROM agent_node_refresh_tokens WHERE id = $1 FOR UPDATE',
        [row.id]
      );
      row = locked.rows[0];
      if (!row || !AgentTokenService.matches(token, row.token_hash)) {
        throw fail(401, 'REFRESH_TOKEN_INVALID', 'Invalid refresh token');
      }

      if (row.rotated_at && idempotencyKey) {
        const replay = await db.query(
          `SELECT response_ciphertext, expires_at FROM agent_node_refresh_replays
           WHERE refresh_token_id = $1 AND idempotency_key = $2`,
          [row.id, idempotencyKey]
        );
        const cached = replay.rows[0];
        if (cached && new Date(cached.expires_at) > new Date()) {
          await db.query('COMMIT');
          return JSON.parse(decrypt(cached.response_ciphertext));
        }
      }

      if (row.revoked_at || row.rotated_at) {
        await revokeFamily(db, row.node_id);
        await audit(db, {
          nodeId: row.node_id,
          eventType: 'node.refresh_reused',
          ip,
          metadata: { refresh_token_id: row.id },
        });
        await db.query('COMMIT');
        throw fail(401, 'REFRESH_TOKEN_REUSED', 'Refresh token already used; re-enroll this node');
      }
      if (new Date(row.expires_at) <= new Date()) {
        throw fail(401, 'REFRESH_TOKEN_INVALID', 'Invalid refresh token');
      }

      const pair = await issueCredentialPair(db, row.node_id, row.family_id);
      await db.query(
        'UPDATE agent_node_refresh_tokens SET rotated_at = NOW(), replaced_by_id = $1 WHERE id = $2',
        [pair.refreshTokenId, row.id]
      );
      const payload = {
        access_token: pair.accessToken,
        refresh_token: pair.refreshToken,
        access_expires_at: pair.accessExpiresAt,
        refresh_expires_at: pair.refreshExpiresAt,
      };
      if (idempotencyKey) {
        const replayExpiresAt = new Date(
          Date.now() + intEnv('AGENT_REFRESH_REPLAY_CACHE_SECONDS', 60) * 1000
        );
        await db.query(
          `INSERT INTO agent_node_refresh_replays
             (refresh_token_id, idempotency_key, response_ciphertext, expires_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (refresh_token_id, idempotency_key)
           DO UPDATE SET response_ciphertext = EXCLUDED.response_ciphertext,
                         expires_at = EXCLUDED.expires_at`,
          [row.id, idempotencyKey, encrypt(JSON.stringify(payload)), replayExpiresAt]
        );
      }
      await audit(db, {
        nodeId: row.node_id,
        eventType: 'node.refresh_rotated',
        ip,
        metadata: { refresh_token_id: row.id },
      });
      await db.query('COMMIT');
      return payload;
    } catch (error) {
      await db.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      db.release();
    }
  }

  async listNodes(user) {
    if (!user) throw fail(401, 'UNAUTHORIZED', 'Authentication required');
    if (user.role === 'super_admin') {
      const all = await pool.query('SELECT * FROM agent_nodes ORDER BY created_at DESC');
      return all.rows;
    }
    const result = await pool.query(
      `SELECT DISTINCT n.*
       FROM agent_nodes n
       WHERE n.owner_id = $1
          OR EXISTS (
            SELECT 1 FROM agent_node_grants g
            JOIN projects p ON p.id = g.project_id
            WHERE g.node_id = n.id AND g.revoked_at IS NULL
              AND (p.owner_id = $1
                   OR EXISTS (SELECT 1 FROM project_memberships m
                              WHERE m.project_id = p.id AND m.user_id = $1))
          )
       ORDER BY n.created_at DESC`,
      [user.userId]
    );
    return result.rows;
  }

  async getNodeForUser(nodeId, user) {
    const result = await pool.query('SELECT * FROM agent_nodes WHERE id = $1', [nodeId]);
    const node = result.rows[0];
    if (!node) throw fail(404, 'NODE_NOT_FOUND', 'Node not found');
    if (user.role === 'super_admin' || String(node.owner_id) === String(user.userId)) {
      return node;
    }
    const shared = await pool.query(
      `SELECT 1 FROM agent_node_grants g
       JOIN projects p ON p.id = g.project_id
       WHERE g.node_id = $1 AND g.revoked_at IS NULL
         AND (p.owner_id = $2
              OR EXISTS (SELECT 1 FROM project_memberships m
                         WHERE m.project_id = p.id AND m.user_id = $2))`,
      [nodeId, user.userId]
    );
    if (shared.rows.length === 0) throw fail(404, 'NODE_NOT_FOUND', 'Node not found');
    return node;
  }

  async revoke(nodeId, { actorId = null, ip = null } = {}) {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const updated = await db.query(
        `UPDATE agent_nodes SET status = 'revoked' WHERE id = $1 RETURNING *`,
        [nodeId]
      );
      if (updated.rows.length === 0) throw fail(404, 'NODE_NOT_FOUND', 'Node not found');
      await db.query(
        `UPDATE agent_runtimes SET status = 'stopped' WHERE node_id = $1 AND status <> 'stopped'`,
        [nodeId]
      );
      await revokeFamily(db, nodeId);
      await audit(db, {
        nodeId,
        eventType: 'node.revoked',
        actorType: actorId == null ? 'system' : 'user',
        actorId: actorId == null ? null : String(actorId),
        ip,
      });
      await db.query('COMMIT');
      return updated.rows[0];
    } catch (error) {
      await db.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      db.release();
    }
  }

  async drain(nodeId, { actorId = null, ip = null } = {}) {
    const updated = await pool.query(
      `UPDATE agent_nodes SET status = 'draining'
       WHERE id = $1 AND status = 'active' RETURNING *`,
      [nodeId]
    );
    if (updated.rows.length === 0) {
      const exists = await pool.query('SELECT 1 FROM agent_nodes WHERE id = $1', [nodeId]);
      if (exists.rows.length === 0) throw fail(404, 'NODE_NOT_FOUND', 'Node not found');
      const current = await pool.query('SELECT * FROM agent_nodes WHERE id = $1', [nodeId]);
      return current.rows[0];
    }
    await audit(pool, {
      nodeId,
      eventType: 'node.draining',
      actorType: actorId == null ? 'system' : 'user',
      actorId: actorId == null ? null : String(actorId),
      ip,
    });
    return updated.rows[0];
  }

  async listGrants(nodeId, user = null) {
    const node = await pool.query('SELECT owner_id FROM agent_nodes WHERE id = $1', [nodeId]);
    const isOwner =
      user &&
      (user.role === 'super_admin' ||
        (node.rows[0] && String(node.rows[0].owner_id) === String(user.userId)));
    if (!user || isOwner) {
      const result = await pool.query(
        `SELECT * FROM agent_node_grants
         WHERE node_id = $1 AND revoked_at IS NULL
         ORDER BY created_at DESC`,
        [nodeId]
      );
      return result.rows;
    }
    const result = await pool.query(
      `SELECT g.* FROM agent_node_grants g
       WHERE g.node_id = $1 AND g.revoked_at IS NULL
         AND (EXISTS (SELECT 1 FROM projects p WHERE p.id = g.project_id AND p.owner_id = $2)
              OR EXISTS (SELECT 1 FROM project_memberships m
                         WHERE m.project_id = g.project_id AND m.user_id = $2))
       ORDER BY g.created_at DESC`,
      [nodeId, user.userId]
    );
    return result.rows;
  }

  async createGrant(nodeId, projectId, role, { actorId = null, ip = null } = {}) {
    if (!ROLES.includes(role)) throw fail(400, 'INVALID_ROLE', 'Invalid role');
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const reactivated = await db.query(
        `UPDATE agent_node_grants SET revoked_at = NULL, created_by = $4
         WHERE node_id = $1 AND project_id = $2 AND role = $3 AND revoked_at IS NOT NULL
         RETURNING *`,
        [nodeId, projectId, role, actorId]
      );
      let grant = reactivated.rows[0];
      if (!grant) {
        const inserted = await db.query(
          `INSERT INTO agent_node_grants (node_id, project_id, role, created_by)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [nodeId, projectId, role, actorId]
        );
        grant = inserted.rows[0];
      }
      await audit(db, {
        nodeId,
        projectId,
        eventType: 'grant.created',
        actorType: actorId == null ? 'system' : 'user',
        actorId: actorId == null ? null : String(actorId),
        ip,
        metadata: { role },
      });
      await db.query('COMMIT');
      return grant;
    } catch (error) {
      await db.query('ROLLBACK').catch(() => {});
      if (error.code === '23505') throw fail(409, 'GRANT_EXISTS', 'Grant already active');
      throw error;
    } finally {
      db.release();
    }
  }

  async deleteGrant(nodeId, grantId, { actorId = null, ip = null } = {}) {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const revoked = await db.query(
        `UPDATE agent_node_grants SET revoked_at = NOW()
         WHERE id = $1 AND node_id = $2 AND revoked_at IS NULL
         RETURNING *`,
        [grantId, nodeId]
      );
      if (revoked.rows.length === 0) throw fail(404, 'GRANT_NOT_FOUND', 'Grant not found');
      await audit(db, {
        nodeId,
        projectId: revoked.rows[0].project_id,
        eventType: 'grant.revoked',
        actorType: actorId == null ? 'system' : 'user',
        actorId: actorId == null ? null : String(actorId),
        ip,
        metadata: { role: revoked.rows[0].role },
      });
      await db.query('COMMIT');
      return revoked.rows[0];
    } catch (error) {
      await db.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      db.release();
    }
  }

  async config(nodeId) {
    const node = await pool.query('SELECT * FROM agent_nodes WHERE id = $1', [nodeId]);
    if (node.rows.length === 0) throw fail(404, 'NODE_NOT_FOUND', 'Node not found');
    const grants = await pool.query(
      `SELECT project_id, role FROM agent_node_grants
       WHERE node_id = $1 AND revoked_at IS NULL`,
      [nodeId]
    );
    const runtimes = await pool.query(
      `SELECT r.id, r.name, r.role, r.concurrency, r.effort, r.status,
              r.current_project_id, r.model_id,
              pm.model, pm.roles AS model_roles, pm.effort AS model_effort,
              pm.max_tokens, pm.context_window,
              pc.id AS credential_id, pc.name AS credential_name,
              pc.provider_type, pc.base_url
       FROM agent_runtimes r
       JOIN provider_models pm ON pm.id = r.model_id
       JOIN provider_credentials pc ON pc.id = pm.credential_id
       WHERE r.node_id = $1
       ORDER BY r.name`,
      [nodeId]
    );
    return { node: node.rows[0], grants: grants.rows, runtimes: runtimes.rows };
  }

  async resolveModel(db, nodeOwnerId, ref, projectId) {
    if (!ref) throw fail(400, 'MODEL_REQUIRED', 'modelRef is required');
    let credentialName;
    let model;
    const slash = String(ref).indexOf('/');
    if (slash > 0) {
      credentialName = String(ref).slice(0, slash);
      model = String(ref).slice(slash + 1);
    } else {
      model = String(ref);
    }
    const params = [nodeOwnerId, model];
    let scope = '';
    if (credentialName) {
      params.push(credentialName);
      scope = `AND pc.name = $${params.length}`;
    }
    if (projectId != null) {
      params.push(projectId);
      scope += ` AND (pc.project_id IS NULL OR pc.project_id = $${params.length})`;
    } else {
      scope += ' AND pc.project_id IS NULL';
    }
    const result = await db.query(
      `SELECT pm.*, pc.owner_id, pc.name AS credential_name
       FROM provider_models pm
       JOIN provider_credentials pc ON pc.id = pm.credential_id
       WHERE pc.owner_id = $1 AND pm.model = $2 ${scope}
         AND pc.status = 'active' AND pm.status = 'verified'`,
      params
    );
    if (result.rows.length === 0) {
      throw fail(400, 'MODEL_NOT_FOUND', 'Model not found for this owner/scope');
    }
    if (result.rows.length > 1) {
      throw fail(409, 'MODEL_AMBIGUOUS', 'Model reference is ambiguous; include the credential name');
    }
    return result.rows[0];
  }

  async declareRuntimes(node, items) {
    if (!Array.isArray(items)) throw fail(400, 'INVALID_RUNTIMES', 'runtimes must be an array');
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const results = [];
      for (const item of items) {
        const role = item.role;
        if (!ROLES.includes(role)) throw fail(400, 'INVALID_ROLE', 'Invalid role');
        const effort = item.effort == null ? null : String(item.effort);
        if (effort != null && !EFFORTS.includes(effort)) {
          throw fail(400, 'INVALID_EFFORT', 'Invalid effort');
        }
        if (item.projectId != null) {
          const grant = await db.query(
            `SELECT 1 FROM agent_node_grants
             WHERE node_id = $1 AND project_id = $2 AND role = $3 AND revoked_at IS NULL`,
            [node.id, item.projectId, role]
          );
          if (grant.rows.length === 0) {
            throw fail(403, 'GRANT_REQUIRED', 'No active grant for this project/role');
          }
        } else if (role === 'worker') {
          throw fail(400, 'PROJECT_REQUIRED', 'worker runtimes require projectId');
        }
        const model = await this.resolveModel(db, node.owner_id, item.modelRef, item.projectId);
        if (!model.roles.includes(role)) {
          throw fail(400, 'ROLE_NOT_ALLOWED', 'Model is not tagged for this role');
        }
        const concurrency = item.concurrency == null ? 1 : parseInt(item.concurrency, 10);
        if (!Number.isFinite(concurrency) || concurrency < 1) {
          throw fail(400, 'INVALID_CONCURRENCY', 'concurrency must be >= 1');
        }
        const name = item.name || `${role}-${model.model}-${results.length + 1}`;
        const upsert = await db.query(
          `INSERT INTO agent_runtimes
             (node_id, name, role, model_id, concurrency, effort, status, current_project_id)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
           ON CONFLICT (node_id, name)
           DO UPDATE SET role = EXCLUDED.role, model_id = EXCLUDED.model_id,
                         concurrency = EXCLUDED.concurrency, effort = EXCLUDED.effort,
                         current_project_id = EXCLUDED.current_project_id,
                         updated_at = NOW()
           RETURNING *`,
          [node.id, name, role, model.id, concurrency, effort, item.projectId || null]
        );
        results.push(upsert.rows[0]);
      }
      await audit(db, {
        nodeId: node.id,
        eventType: 'runtimes.declared',
        metadata: { count: results.length },
      });
      await db.query('COMMIT');
      return results;
    } catch (error) {
      await db.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      db.release();
    }
  }

  async heartbeat(node, runtimeId, { status = null, currentProjectId = null } = {}) {
    const runtime = await this.getRuntimeForNode(node.id, runtimeId);
    if (currentProjectId != null) {
      const grant = await pool.query(
        `SELECT 1 FROM agent_node_grants
         WHERE node_id = $1 AND project_id = $2 AND role = $3 AND revoked_at IS NULL`,
        [node.id, currentProjectId, runtime.role]
      );
      if (grant.rows.length === 0) {
        throw fail(403, 'GRANT_REQUIRED', 'No active grant for this project/role');
      }
    }
    const updated = await pool.query(
      `UPDATE agent_runtimes
       SET last_seen_at = NOW(),
           status = COALESCE($3, status),
           current_project_id = $4,
           updated_at = NOW()
       WHERE id = $1 AND node_id = $2
       RETURNING *`,
      [runtimeId, node.id, status, currentProjectId]
    );
    if (updated.rows.length === 0) throw fail(404, 'RUNTIME_NOT_FOUND', 'Runtime not found');
    await pool.query('UPDATE agent_nodes SET last_seen_at = NOW() WHERE id = $1', [node.id]);
    if (status && status !== runtime.status) {
      await audit(pool, {
        nodeId: node.id,
        eventType: 'runtime.status_changed',
        metadata: { runtime_id: runtime.id, from: runtime.status, to: status },
      });
    }
    return updated.rows[0];
  }

  async getRuntimeForNode(nodeId, runtimeId) {
    const result = await pool.query(
      'SELECT * FROM agent_runtimes WHERE id = $1 AND node_id = $2',
      [runtimeId, nodeId]
    );
    if (result.rows.length === 0) throw fail(404, 'RUNTIME_NOT_FOUND', 'Runtime not found');
    return result.rows[0];
  }
}

module.exports = new AgentNodeService();
module.exports.AgentNodeError = AgentNodeError;
module.exports.ROLES = ROLES;
module.exports.EFFORTS = EFFORTS;
