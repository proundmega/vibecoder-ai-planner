const ProviderRouter = require('../services/ProviderRouter');
const { encrypt, decrypt, maskToken } = require('../utils/crypto');
const { NotFoundError, ConflictError } = require('../errors/HttpError');
const Project = require('../models/project');
const { pool } = require('../db');

async function addProvider(req, res, next) {
  try {
    const { projectId } = req.params;
    const { name, providerType, apiKey, baseUrl, model, roles, maxTokens, temperature, endpoint_url, fallback_provider, routing_rules, is_project_director } = req.body;

    const project = await Project.findById(projectId);
    if (!project) throw new NotFoundError('Project not found');

    const encryptedKey = apiKey ? encrypt(apiKey) : null;

    const localModels = {
      ollama: 'llama3',
      vllm: 'meta-llama/Llama-3-8b',
      llamacpp: 'llama-3-8b',
      custom: 'custom-model',
    };

    const result = await pool.query(
      `INSERT INTO project_providers (project_id, name, provider_type, api_key_encrypted, base_url, model, roles, max_tokens, temperature, endpoint_url, fallback_provider, routing_rules, is_project_director)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [projectId, name, providerType, encryptedKey, baseUrl || null, model || localModels[providerType] || 'gpt-4o', roles || ['worker'], maxTokens || 4096, temperature || 0.1, endpoint_url || null, fallback_provider || null, routing_rules || '{}', is_project_director || false]
    );

    if (is_project_director) {
      await pool.query(
        'UPDATE project_providers SET is_project_director = false WHERE project_id = $1 AND id != $2',
        [projectId, result.rows[0].id]
      );
    }

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
        endpoint_url: row.endpoint_url,
        fallback_provider: row.fallback_provider,
        routing_rules: row.routing_rules,
        is_project_director: row.is_project_director,
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
    const { projectId, providerId } = req.params;
    const { name, providerType, apiKey, baseUrl, model, roles, maxTokens, temperature, isActive, endpoint_url, fallback_provider, routing_rules, is_project_director } = req.body;

    const project = await Project.findById(projectId);
    if (!project) throw new NotFoundError('Project not found');

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
      values.push(apiKey ? encrypt(apiKey) : null);
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
    if (endpoint_url !== undefined) {
      updates.push(`endpoint_url = $${paramIndex++}`);
      values.push(endpoint_url || null);
    }
    if (fallback_provider !== undefined) {
      updates.push(`fallback_provider = $${paramIndex++}`);
      values.push(fallback_provider || null);
    }
    if (routing_rules !== undefined) {
      updates.push(`routing_rules = $${paramIndex++}`);
      values.push(routing_rules || '{}');
    }
    if (is_project_director !== undefined && is_project_director) {
      await pool.query(
        'UPDATE project_providers SET is_project_director = false WHERE project_id = $1 AND id != $2',
        [projectId, providerId]
      );
      updates.push(`is_project_director = $${paramIndex++}`);
      values.push(true);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'No fields to update' } });
    }

    updates.push(`updated_at = NOW()`);
    values.push(providerId);
    paramIndex++;

    const result = await pool.query(
      `UPDATE project_providers SET ${updates.join(', ')} WHERE id = $${paramIndex} AND project_id = $1 RETURNING *`,
      [projectId, ...values]
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
        endpoint_url: row.endpoint_url,
        fallback_provider: row.fallback_provider,
        routing_rules: row.routing_rules,
        is_project_director: row.is_project_director,
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
    const { projectId, providerId } = req.params;

    const project = await Project.findById(projectId);
    if (!project) throw new NotFoundError('Project not found');

    const result = await pool.query(
      'DELETE FROM project_providers WHERE id = $1 AND project_id = $2 RETURNING *',
      [providerId, projectId]
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
    const { projectId } = req.params;

    const project = await Project.findById(projectId);
    if (!project) throw new NotFoundError('Project not found');

    const result = await pool.query(
      `SELECT id, project_id, name, provider_type, api_key_encrypted, base_url, model, roles, max_tokens, temperature, is_active, endpoint_url, fallback_provider, routing_rules, is_project_director, created_at, updated_at
       FROM project_providers
       WHERE project_id = $1
       ORDER BY created_at DESC`,
      [projectId]
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
      endpoint_url: row.endpoint_url,
      fallback_provider: row.fallback_provider,
      routing_rules: row.routing_rules,
      is_project_director: row.is_project_director,
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
    const { projectId, providerId } = req.params;

    const project = await Project.findById(projectId);
    if (!project) throw new NotFoundError('Project not found');

    const result = await pool.query(
      'SELECT * FROM project_providers WHERE id = $1 AND project_id = $2',
      [providerId, projectId]
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

async function setDirector(req, res, next) {
  try {
    const { projectId, providerId } = req.params;

    const project = await Project.findById(projectId);
    if (!project) throw new NotFoundError('Project not found');

    const result = await pool.query(
      'SELECT id FROM project_providers WHERE id = $1 AND project_id = $2',
      [providerId, projectId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Provider not found');
    }

    await pool.query(
      'UPDATE project_providers SET is_project_director = false WHERE project_id = $1 AND id != $2',
      [projectId, providerId]
    );

    await pool.query(
      'UPDATE project_providers SET is_project_director = true, updated_at = NOW() WHERE id = $1 AND project_id = $2',
      [providerId, projectId]
    );

    const updated = await pool.query(
      'SELECT * FROM project_providers WHERE id = $1 AND project_id = $2',
      [providerId, projectId]
    );

    const row = updated.rows[0];
    res.json({
      success: true,
      data: {
        id: row.id,
        projectId: row.project_id,
        name: row.name,
        providerType: row.provider_type,
        baseUrl: row.base_url,
        model: row.model,
        roles: row.roles,
        maxTokens: row.max_tokens,
        temperature: row.temperature,
        isActive: row.is_active,
        endpoint_url: row.endpoint_url,
        fallback_provider: row.fallback_provider,
        routing_rules: row.routing_rules,
        is_project_director: row.is_project_director,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function getProviderConfig(req, res, next) {
  try {
    const { projectId } = req.params;
    res.status(410).json({
      success: false,
      error: { code: 'GONE', message: 'Provider Config has been merged into AI Providers. Use GET /api/v1/providers/:projectId/providers?director=true to get the project director.' },
    });
  } catch (error) {
    next(error);
  }
}

async function setProviderConfig(req, res, next) {
  try {
    const { projectId } = req.params;
    res.status(410).json({
      success: false,
      error: { code: 'GONE', message: 'Provider Config has been merged into AI Providers. Use PUT /api/v1/providers/:projectId/providers/:providerId to update, or POST /api/v1/providers/:projectId/providers to create.' },
    });
  } catch (error) {
    next(error);
  }
}

async function deleteProviderConfig(req, res, next) {
  try {
    const { projectId } = req.params;
    res.status(410).json({
      success: false,
      error: { code: 'GONE', message: 'Provider Config has been merged into AI Providers. Use DELETE /api/v1/providers/:projectId/providers/:providerId to delete a provider.' },
    });
  } catch (error) {
    next(error);
  }
}

async function testProviderConnection(req, res, next) {
  try {
    const { projectId } = req.params;
    res.status(410).json({
      success: false,
      error: { code: 'GONE', message: 'Provider Config has been merged into AI Providers. Use POST /api/v1/providers/:projectId/providers/:providerId/test to test a specific provider.' },
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
  setDirector,
  getProviderConfig,
  setProviderConfig,
  deleteProviderConfig,
  testProviderConnection,
};
