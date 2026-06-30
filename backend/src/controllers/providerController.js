const ProviderRouter = require('../services/ProviderRouter');
const { encrypt, decrypt, maskToken } = require('../utils/crypto');
const { NotFoundError } = require('../errors/HttpError');
const Project = require('../models/project');

async function addProvider(req, res, next) {
  try {
    const { id } = req.params;
    const { name, providerType, apiKey, baseUrl, model, roles, maxTokens, temperature } = req.body;

    const project = await Project.findById(id);
    if (!project) throw new NotFoundError('Project not found');

    const encryptedKey = encrypt(apiKey);

    const { pool } = require('../db');
    const result = await pool.query(
      `INSERT INTO project_providers (project_id, name, provider_type, api_key_encrypted, base_url, model, roles, max_tokens, temperature)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [id, name, providerType, encryptedKey, baseUrl || null, model, roles || ['worker'], maxTokens || 4096, temperature || 0.1]
    );

    const row = result.rows[0];
    res.status(201).json({
      success: true,
      data: {
        id: row.id,
        projectId: row.project_id,
        name: row.name,
        providerType: row.provider_type,
        apiKey: maskToken(apiKey),
        baseUrl: row.base_url,
        model: row.model,
        roles: row.roles,
        maxTokens: row.max_tokens,
        temperature: row.temperature,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function updateProvider(req, res, next) {
  try {
    const { id, providerId } = req.params;
    const { name, providerType, apiKey, baseUrl, model, roles, maxTokens, temperature, isActive } = req.body;

    const project = await Project.findById(id);
    if (!project) throw new NotFoundError('Project not found');

    const { pool } = require('../db');

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (providerType !== undefined) {
      updates.push(`provider_type = $${paramIndex++}`);
      values.push(providerType);
    }
    if (apiKey !== undefined) {
      updates.push(`api_key_encrypted = $${paramIndex++}`);
      values.push(encrypt(apiKey));
    }
    if (baseUrl !== undefined) {
      updates.push(`base_url = $${paramIndex++}`);
      values.push(baseUrl);
    }
    if (model !== undefined) {
      updates.push(`model = $${paramIndex++}`);
      values.push(model);
    }
    if (roles !== undefined) {
      updates.push(`roles = $${paramIndex++}`);
      values.push(roles);
    }
    if (maxTokens !== undefined) {
      updates.push(`max_tokens = $${paramIndex++}`);
      values.push(maxTokens);
    }
    if (temperature !== undefined) {
      updates.push(`temperature = $${paramIndex++}`);
      values.push(temperature);
    }
    if (isActive !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(isActive);
    }

    updates.push(`updated_at = NOW()`);
    values.push(providerId);

    const result = await pool.query(
      `UPDATE project_providers SET ${updates.join(', ')} WHERE id = $${paramIndex} AND project_id = $1 RETURNING *`,
      [id, ...values]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Provider not found');
    }

    const row = result.rows[0];
    res.json({
      success: true,
      data: {
        id: row.id,
        projectId: row.project_id,
        name: row.name,
        providerType: row.provider_type,
        apiKey: maskToken(decrypt(row.api_key_encrypted)),
        baseUrl: row.base_url,
        model: row.model,
        roles: row.roles,
        maxTokens: row.max_tokens,
        temperature: row.temperature,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function deleteProvider(req, res, next) {
  try {
    const { id, providerId } = req.params;

    const project = await Project.findById(id);
    if (!project) throw new NotFoundError('Project not found');

    const { pool } = require('../db');
    const result = await pool.query(
      'DELETE FROM project_providers WHERE id = $1 AND project_id = $2 RETURNING *',
      [providerId, id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Provider not found');
    }

    res.json({ success: true, data: { message: 'Provider deleted' } });
  } catch (error) {
    next(error);
  }
}

async function listProviders(req, res, next) {
  try {
    const { id } = req.params;

    const project = await Project.findById(id);
    if (!project) throw new NotFoundError('Project not found');

    const { pool } = require('../db');
    const result = await pool.query(
      `SELECT id, project_id, name, provider_type, api_key_encrypted, base_url, model, roles, max_tokens, temperature, is_active, created_at, updated_at
       FROM project_providers
       WHERE project_id = $1
       ORDER BY created_at DESC`,
      [id]
    );

    const providers = result.rows.map(row => ({
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      providerType: row.provider_type,
      apiKey: maskToken(decrypt(row.api_key_encrypted)),
      baseUrl: row.base_url,
      model: row.model,
      roles: row.roles,
      maxTokens: row.max_tokens,
      temperature: row.temperature,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    res.json({ success: true, data: providers });
  } catch (error) {
    next(error);
  }
}

async function testProvider(req, res, next) {
  try {
    const { id, providerId } = req.params;

    const project = await Project.findById(id);
    if (!project) throw new NotFoundError('Project not found');

    const { pool } = require('../db');
    const result = await pool.query(
      'SELECT * FROM project_providers WHERE id = $1 AND project_id = $2',
      [providerId, id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Provider not found');
    }

    const providerConfig = result.rows[0];
    const decryptedKey = decrypt(providerConfig.api_key_encrypted);
    const config = {
      apiKey: decryptedKey,
      model: providerConfig.model,
      maxTokens: providerConfig.max_tokens,
      temperature: providerConfig.temperature,
      baseUrl: providerConfig.base_url,
    };

    const router = new ProviderRouter(project.id);
    const provider = router.createProvider(providerConfig.provider_type, config);
    const isValid = await provider.validate();

    res.json({
      success: true,
      data: {
        valid: isValid,
        message: isValid ? 'Connection successful' : 'Invalid API key',
      },
    });
  } catch (error) {
    next(error);
  }
}

async function getProviderConfig(req, res, next) {
  try {
    const { projectId } = req.params;

    const project = await Project.findById(projectId);
    if (!project) throw new NotFoundError('Project not found');

    const { pool } = require('../db');
    const result = await pool.query(
      'SELECT * FROM provider_configs WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1',
      [projectId]
    );

    if (result.rows.length === 0) {
      return res.json({ success: true, data: null });
    }

    const row = result.rows[0];
    res.json({
      success: true,
      data: {
        id: row.id,
        projectId: row.project_id,
        provider: row.provider,
        endpoint_url: row.endpoint_url,
        model: row.model,
        api_key: row.api_key_encrypted ? maskToken(decrypt(row.api_key_encrypted)) : null,
        fallback_provider: row.fallback_provider,
        routing_rules: row.routing_rules,
        is_active: row.is_active,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function setProviderConfig(req, res, next) {
  try {
    const { projectId } = req.params;
    const { provider, endpoint_url, model, api_key, fallback_provider, routing_rules } = req.body;

    const project = await Project.findById(projectId);
    if (!project) throw new NotFoundError('Project not found');

    const { pool } = require('../db');
    const encryptedKey = api_key ? encrypt(api_key) : null;

    const result = await pool.query(
      `INSERT INTO provider_configs (project_id, provider, endpoint_url, model, api_key_encrypted, fallback_provider, routing_rules, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW())
       ON CONFLICT (project_id, provider) DO UPDATE
       SET endpoint_url = EXCLUDED.endpoint_url,
           model = EXCLUDED.model,
           api_key_encrypted = COALESCE(EXCLUDED.api_key_encrypted, provider_configs.api_key_encrypted),
           fallback_provider = COALESCE(EXCLUDED.fallback_provider, provider_configs.fallback_provider),
           routing_rules = COALESCE(EXCLUDED.routing_rules, provider_configs.routing_rules),
           updated_at = NOW()
       RETURNING *`,
      [projectId, provider, endpoint_url || null, model, encryptedKey, fallback_provider || null, routing_rules || '{}']
    );

    const row = result.rows[0];
    res.status(201).json({
      success: true,
      data: {
        id: row.id,
        projectId: row.project_id,
        provider: row.provider,
        endpoint_url: row.endpoint_url,
        model: row.model,
        api_key: row.api_key_encrypted ? maskToken(decrypt(row.api_key_encrypted)) : null,
        fallback_provider: row.fallback_provider,
        routing_rules: row.routing_rules,
        is_active: row.is_active,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function deleteProviderConfig(req, res, next) {
  try {
    const { projectId } = req.params;

    const project = await Project.findById(projectId);
    if (!project) throw new NotFoundError('Project not found');

    const { pool } = require('../db');
    const result = await pool.query(
      'DELETE FROM provider_configs WHERE project_id = $1 RETURNING *',
      [projectId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Provider config not found');
    }

    res.json({ success: true, data: { message: 'Provider config deleted' } });
  } catch (error) {
    next(error);
  }
}

async function testProviderConnection(req, res, next) {
  try {
    const { projectId } = req.params;
    const { provider, endpoint_url, model, api_key } = req.body;

    const project = await Project.findById(projectId);
    if (!project) throw new NotFoundError('Project not found');

    const config = {
      apiKey: api_key || null,
      model: model || null,
      baseUrl: endpoint_url || null,
    };

    const router = new ProviderRouter(project.id);
    const providerInstance = router.createProvider(provider || 'openai', config);
    const isValid = await providerInstance.validate();

    res.json({
      success: true,
      data: {
        valid: isValid,
        message: isValid ? 'Connection successful' : 'Connection failed',
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  addProvider,
  updateProvider,
  deleteProvider,
  listProviders,
  testProvider,
  getProviderConfig,
  setProviderConfig,
  deleteProviderConfig,
  testProviderConnection,
};
