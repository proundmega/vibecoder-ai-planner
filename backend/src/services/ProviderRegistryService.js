const { pool } = require('../db');
const { encrypt, decrypt } = require('../utils/crypto');

const ROLES = ['worker', 'reviewer', 'planner'];
const EFFORTS = ['minimal', 'low', 'medium', 'high', 'max'];

class RegistryError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) {
  return new RegistryError(status, code, message);
}

function publicCredential(row) {
  if (!row) return row;
  const copy = { ...row };
  delete copy.api_key_encrypted;
  return copy;
}

function defaultBase(providerType) {
  switch (providerType) {
    case 'claude':
    case 'anthropic':
      return 'https://api.anthropic.com';
    case 'openai':
    case 'opencode':
    case 'opencode-go':
      return 'https://api.openai.com';
    default:
      return null;
  }
}

async function fetchJson(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text.slice(0, 300) };
    }
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

class ProviderRegistryService {
  static RegistryError = RegistryError;

  async canManageProject(user, projectId) {
    if (!user) return false;
    if (user.role === 'super_admin') return true;
    if (user.role !== 'project_admin') return false;
    const result = await pool.query(
      `SELECT 1 FROM projects p
       WHERE p.id = $1
         AND (p.owner_id = $2
              OR EXISTS (SELECT 1 FROM project_memberships m
                         WHERE m.project_id = p.id AND m.user_id = $2))`,
      [projectId, user.userId]
    );
    return result.rows.length > 0;
  }

  async assertScope(user, credential) {
    if (!user) throw fail(401, 'UNAUTHORIZED', 'Authentication required');
    if (user.role === 'super_admin') return;
    if (credential.project_id == null) {
      if (String(credential.owner_id) !== String(user.userId)) {
        throw fail(404, 'CREDENTIAL_NOT_FOUND', 'Credential not found');
      }
      return;
    }
    if (!(await this.canManageProject(user, credential.project_id))) {
      throw fail(404, 'CREDENTIAL_NOT_FOUND', 'Credential not found');
    }
  }

  async loadCredential(id) {
    const result = await pool.query('SELECT * FROM provider_credentials WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      throw fail(404, 'CREDENTIAL_NOT_FOUND', 'Credential not found');
    }
    return result.rows[0];
  }

  async loadModel(id) {
    const result = await pool.query(
      `SELECT pm.*, pc.owner_id, pc.project_id
       FROM provider_models pm
       JOIN provider_credentials pc ON pc.id = pm.credential_id
       WHERE pm.id = $1`,
      [id]
    );
    if (result.rows.length === 0) throw fail(404, 'MODEL_NOT_FOUND', 'Model not found');
    return result.rows[0];
  }

  async list(user) {
    if (!user) throw fail(401, 'UNAUTHORIZED', 'Authentication required');
    const result =
      user.role === 'super_admin'
        ? await pool.query('SELECT * FROM provider_credentials ORDER BY created_at DESC')
        : await pool.query(
          `SELECT DISTINCT pc.* FROM provider_credentials pc
           WHERE pc.owner_id = $1
              OR (pc.project_id IS NOT NULL AND (
                    EXISTS (SELECT 1 FROM projects p
                            WHERE p.id = pc.project_id AND p.owner_id = $1)
                    OR EXISTS (SELECT 1 FROM project_memberships m
                               WHERE m.project_id = pc.project_id AND m.user_id = $1)))
           ORDER BY pc.created_at DESC`,
          [user.userId]
        );
    return result.rows.map(publicCredential);
  }

  async create(user, {
    projectId = null,
    name,
    providerType,
    apiKey,
    baseUrl = null,
  }) {
    if (!user) throw fail(401, 'UNAUTHORIZED', 'Authentication required');
    if (!name || !String(name).trim()) throw fail(400, 'NAME_REQUIRED', 'name is required');
    if (!providerType) throw fail(400, 'TYPE_REQUIRED', 'providerType is required');
    if (!apiKey) throw fail(400, 'KEY_REQUIRED', 'apiKey is required');
    if (projectId != null && !(await this.canManageProject(user, projectId))) {
      throw fail(403, 'FORBIDDEN', 'Project admin required');
    }
    try {
      const result = await pool.query(
        `INSERT INTO provider_credentials
           (owner_id, project_id, name, provider_type, api_key_encrypted, base_url, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $1)
         RETURNING *`,
        [user.userId, projectId, name, providerType, encrypt(apiKey), baseUrl]
      );
      return publicCredential(result.rows[0]);
    } catch (error) {
      if (error.code === '23505') throw fail(409, 'CREDENTIAL_EXISTS', 'Credential name already exists');
      throw error;
    }
  }

  async update(user, id, { apiKey, baseUrl, status }) {
    const credential = await this.loadCredential(id);
    await this.assertScope(user, credential);
    const nextStatus = status || credential.status;
    if (!['active', 'disabled'].includes(nextStatus)) {
      throw fail(400, 'INVALID_STATUS', 'Invalid status');
    }
    const rotating = apiKey != null && String(apiKey).length > 0;
    const result = await pool.query(
      `UPDATE provider_credentials
       SET api_key_encrypted = COALESCE($2, api_key_encrypted),
           base_url = COALESCE($3, base_url),
           status = $4,
           version = version + CASE WHEN $5 THEN 1 ELSE 0 END,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, rotating ? encrypt(apiKey) : null, baseUrl ?? null, nextStatus, rotating]
    );
    return publicCredential(result.rows[0]);
  }

  async remove(user, id) {
    const credential = await this.loadCredential(id);
    await this.assertScope(user, credential);
    const models = await pool.query(
      'SELECT id, model FROM provider_models WHERE credential_id = $1',
      [id]
    );
    if (models.rows.length > 0) {
      throw fail(409, 'CREDENTIAL_IN_USE', 'Detach or delete its models first', {
        models: models.rows,
      });
    }
    await pool.query('DELETE FROM provider_credentials WHERE id = $1', [id]);
    return { id };
  }

  async addModel(user, credentialId, {
    model,
    displayName = null,
    roles = [],
    effort = 'medium',
    maxTokens = null,
    contextWindow = null,
  }) {
    const credential = await this.loadCredential(credentialId);
    await this.assertScope(user, credential);
    if (!model) throw fail(400, 'MODEL_REQUIRED', 'model is required');
    if (!Array.isArray(roles) || roles.some((role) => !ROLES.includes(role))) {
      throw fail(400, 'INVALID_ROLE', 'roles must be worker/reviewer/planner');
    }
    if (!EFFORTS.includes(effort)) throw fail(400, 'INVALID_EFFORT', 'Invalid effort');
    try {
      const result = await pool.query(
        `INSERT INTO provider_models
           (credential_id, model, display_name, source, status, roles, effort, max_tokens, context_window)
         VALUES ($1, $2, $3, 'manual', 'unverified', $4, $5, $6, $7)
         RETURNING *`,
        [credentialId, model, displayName, roles, effort, maxTokens, contextWindow]
      );
      return result.rows[0];
    } catch (error) {
      if (error.code === '23505') throw fail(409, 'MODEL_EXISTS', 'Model already exists');
      throw error;
    }
  }

  async patchModel(user, id, { roles, status, effort, maxTokens }) {
    const model = await this.loadModel(id);
    await this.assertScope(user, {
      owner_id: model.owner_id,
      project_id: model.project_id,
    });
    if (roles !== undefined && (!Array.isArray(roles) || roles.some((r) => !ROLES.includes(r)))) {
      throw fail(400, 'INVALID_ROLE', 'roles must be worker/reviewer/planner');
    }
    if (status !== undefined && !['unverified', 'verified', 'disabled'].includes(status)) {
      throw fail(400, 'INVALID_STATUS', 'Invalid status');
    }
    if (effort !== undefined && !EFFORTS.includes(effort)) {
      throw fail(400, 'INVALID_EFFORT', 'Invalid effort');
    }
    const result = await pool.query(
      `UPDATE provider_models
       SET roles = COALESCE($2, roles),
           status = COALESCE($3, status),
           effort = COALESCE($4, effort),
           max_tokens = COALESCE($5, max_tokens),
           updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, roles ?? null, status ?? null, effort ?? null, maxTokens ?? null]
    );
    return result.rows[0];
  }

  async removeModel(user, id) {
    const model = await this.loadModel(id);
    await this.assertScope(user, { owner_id: model.owner_id, project_id: model.project_id });
    const used = await pool.query(
      'SELECT id, name FROM agent_runtimes WHERE model_id = $1',
      [id]
    );
    if (used.rows.length > 0) {
      throw fail(409, 'MODEL_IN_USE', 'Model is attached to runtimes', {
        runtimes: used.rows,
      });
    }
    await pool.query('DELETE FROM provider_models WHERE id = $1', [id]);
    return { id };
  }

  async discover(user, credentialId) {
    const credential = await this.loadCredential(credentialId);
    await this.assertScope(user, credential);
    const base = credential.base_url || defaultBase(credential.provider_type);
    if (!base) throw fail(400, 'NO_ENDPOINT', 'Credential has no base URL for discovery');
    const key = decrypt(credential.api_key_encrypted);
    const headers = { 'Content-Type': 'application/json' };
    let url;
    if (credential.provider_type === 'anthropic' || credential.provider_type === 'claude') {
      url = `${base.replace(/\/$/, '')}/v1/models`;
      headers['x-api-key'] = key;
      headers['anthropic-version'] = '2023-06-01';
    } else if (credential.provider_type === 'ollama') {
      url = `${base.replace(/\/$/, '')}/api/tags`;
    } else {
      url = `${base.replace(/\/$/, '')}/v1/models`;
      headers.Authorization = `Bearer ${key}`;
    }

    const response = await fetchJson(url, { headers });
    if (!response.ok) {
      throw fail(502, 'DISCOVERY_FAILED', `Provider returned ${response.status}`);
    }
    const body = response.body || {};
    const names = Array.isArray(body.data)
      ? body.data.map((item) => item.id).filter(Boolean)
      : Array.isArray(body.models)
        ? body.models.map((item) => item.name || item.model).filter(Boolean)
        : [];
    const inserted = [];
    for (const name of names) {
      const result = await pool.query(
        `INSERT INTO provider_models (credential_id, model, source, status, roles)
         VALUES ($1, $2, 'discovered', 'unverified', '{}')
         ON CONFLICT (credential_id, model) DO NOTHING
         RETURNING *`,
        [credentialId, name]
      );
      if (result.rows[0]) inserted.push(result.rows[0]);
    }
    return inserted;
  }

  async testModel(user, id) {
    const model = await this.loadModel(id);
    await this.assertScope(user, { owner_id: model.owner_id, project_id: model.project_id });
    const credential = await this.loadCredential(model.credential_id);
    const base = credential.base_url || defaultBase(credential.provider_type);
    const key = decrypt(credential.api_key_encrypted);
    if (!base) throw fail(400, 'NO_ENDPOINT', 'Credential has no base URL');

    let url;
    let headers = { 'Content-Type': 'application/json' };
    let payload;
    if (credential.provider_type === 'anthropic' || credential.provider_type === 'claude') {
      url = `${base.replace(/\/$/, '')}/v1/messages`;
      headers['x-api-key'] = key;
      headers['anthropic-version'] = '2023-06-01';
      payload = { model: model.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] };
    } else if (credential.provider_type === 'ollama') {
      url = `${base.replace(/\/$/, '')}/api/generate`;
      payload = { model: model.model, prompt: 'ping', stream: false, options: { num_predict: 1 } };
    } else {
      url = `${base.replace(/\/$/, '')}/v1/chat/completions`;
      headers.Authorization = `Bearer ${key}`;
      payload = { model: model.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] };
    }

    try {
      const response = await fetchJson(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const message = `Provider returned ${response.status}`;
        await pool.query(
          `UPDATE provider_models SET status = 'unverified', last_verify_error = $2,
                  last_verified_at = NULL, updated_at = NOW() WHERE id = $1`,
          [id, message]
        );
        throw fail(502, 'MODEL_TEST_FAILED', message);
      }
      const updated = await pool.query(
        `UPDATE provider_models SET status = 'verified', last_verified_at = NOW(),
                last_verify_error = NULL, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [id]
      );
      return { verified: true, model: updated.rows[0] };
    } catch (error) {
      if (error instanceof RegistryError) throw error;
      const message = error.name === 'AbortError' ? 'Provider timeout' : 'Provider unreachable';
      await pool.query(
        `UPDATE provider_models SET status = 'unverified', last_verify_error = $2,
                updated_at = NOW() WHERE id = $1`,
        [id, message]
      );
      throw fail(502, 'MODEL_TEST_FAILED', message);
    }
  }
}

module.exports = new ProviderRegistryService();
module.exports.RegistryError = RegistryError;
module.exports.ROLES = ROLES;
module.exports.EFFORTS = EFFORTS;
