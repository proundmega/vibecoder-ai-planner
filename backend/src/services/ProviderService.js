const db = require('../db');
const axios = require('axios');

async function getConfig(projectId) {
  const { rows } = await db.pool.query(
    'SELECT * FROM provider_configs WHERE project_id = $1 AND is_active = true LIMIT 1',
    [projectId]
  );
  return rows[0] || null;
}

async function setConfig(projectId, { provider, endpoint_url, model, api_key_credential_id, fallback_provider }) {
  const result = await db.pool.query(
    `INSERT INTO provider_configs (project_id, provider, endpoint_url, model, api_key_credential_id, fallback_provider)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (project_id, provider) DO UPDATE
     SET endpoint_url = EXCLUDED.endpoint_url, model = EXCLUDED.model,
         api_key_credential_id = EXCLUDED.api_key_credential_id,
         fallback_provider = EXCLUDED.fallback_provider, updated_at = NOW()
     RETURNING *`,
    [projectId, provider, endpoint_url || null, model, api_key_credential_id || null, fallback_provider || null]
  );
  return result.rows[0];
}

async function deleteConfig(projectId) {
  await db.pool.query(
    'UPDATE provider_configs SET is_active = false, updated_at = NOW() WHERE project_id = $1',
    [projectId]
  );
}

async function testConnection({ endpoint_url, model, api_key }) {
  const start = Date.now();
  try {
    if (!endpoint_url) {
      return { success: false, latency_ms: Date.now() - start, error: 'No endpoint URL configured' };
    }
    const response = await axios.post(
      `${endpoint_url}/chat/completions`,
      {
        model: model || 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 10,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(api_key ? { Authorization: `Bearer ${api_key}` } : {}),
        },
        timeout: 15000,
      }
    );
    if (response.status === 200) {
      return { success: true, latency_ms: Date.now() - start };
    }
    return { success: false, latency_ms: Date.now() - start, error: `HTTP ${response.status}` };
  } catch (err) {
    return { success: false, latency_ms: Date.now() - start, error: err.message };
  }
}

module.exports = { getConfig, setConfig, deleteConfig, testConnection };
