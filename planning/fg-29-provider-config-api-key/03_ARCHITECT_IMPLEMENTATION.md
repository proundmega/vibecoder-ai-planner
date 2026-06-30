# 03_ARCHITECT_IMPLEMENTATION.md — fg-29 Provider Config API Key Field

## Implementation Steps

### Step 1: Database Migration

Create `backend/src/migrations/029_provider_config_api_key.sql`:

```sql
-- Add encrypted API key column to provider_configs
ALTER TABLE provider_configs ADD COLUMN api_key_encrypted TEXT;
```

Create `backend/src/migrations/029_provider_config_api_key_rollback.sql`:

```sql
ALTER TABLE provider_configs DROP COLUMN IF EXISTS api_key_encrypted;
```

Update `backend/src/migrations/apply.js` to include migration 029 in the sequence.

### Step 2: Backend Validator

Update `backend/src/validators/providerConfig.js`:

```js
const setProviderConfigSchema = Joi.object({
  provider: Joi.string().min(1).required().messages({
    'string.empty': 'provider is required',
    'any.required': 'provider is required',
  }),
  endpoint_url: Joi.string().uri().allow('').optional(),
  model: Joi.string().min(1).required().messages({
    'string.empty': 'model is required',
    'any.required': 'model is required',
  }),
  api_key: Joi.string().allow('').optional(),  // NEW: raw API key (optional)
  fallback_provider: Joi.string().allow('').optional(),
});
```

### Step 3: Backend Controller

Update `backend/src/controllers/providerController.js`:

**`getProviderConfig`** — return masked API key:
```js
async function getProviderConfig(req, res, next) {
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
  const maskedKey = row.api_key_encrypted 
    ? maskToken(row.api_key_encrypted)  // first 4 + last 4 visible
    : null;

  res.json({
    success: true,
    data: {
      id: row.id,
      projectId: row.project_id,
      provider: row.provider,
      endpoint_url: row.endpoint_url,
      model: row.model,
      api_key: maskedKey,  // NEW: masked API key (first 4 + last 4 visible)
      fallback_provider: row.fallback_provider,
      routing_rules: row.routing_rules,
      is_active: row.is_active,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
  });
}
```

**`setProviderConfig`** — encrypt and store API key:
```js
async function setProviderConfig(req, res, next) {
  const { projectId } = req.params;
  const { provider, model, endpoint_url, api_key, fallback_provider } = req.body;

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
    [projectId, provider, endpoint_url || null, model, encryptedKey, fallback_provider || null, '{}']
  );

  const row = result.rows[0];
  const maskedKey = row.api_key_encrypted 
    ? maskToken(row.api_key_encrypted)  // first 4 + last 4 visible
    : null;

  res.status(201).json({
    success: true,
    data: {
      id: row.id,
      projectId: row.project_id,
      provider: row.provider,
      endpoint_url: row.endpoint_url,
      model: row.model,
      api_key: maskedKey,
      fallback_provider: row.fallback_provider,
      routing_rules: row.routing_rules,
      is_active: row.is_active,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
  });
}
```

**`testProviderConnection`** — use provided API key:
```js
async function testProviderConnection(req, res, next) {
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
}
```

### Step 4: Frontend API Client

Update `frontend/src/api/providers.js` — keep as-is (sends full config object).

### Step 5: Frontend UI

Update `frontend/src/views/ProjectDetail.vue`:

**Add API key input field** (after Model field, line ~508), visible for all providers:
```vue
<div class="form-group">
  <label>API Key <span class="optional">(optional)</span></label>
  <input v-model="providerConfig.api_key" type="password" placeholder="sk-... (optional for local models)" />
</div>
```

**Update `loadProviderConfig`** (around line 350) — map `api_key` from response:
```js
const loadProviderConfig = async () => {
  try {
    const config = await fetchProviderConfig(projectId)
    if (config) {
      providerConfig.value = {
        provider: config.provider || 'openai',
        model: config.model || '',
        endpoint_url: config.endpoint_url || '',
        api_key: config.api_key || '',
        fallback_provider: config.fallback_provider || null,
      }
    }
  } catch (err) {
    console.error('Failed to load provider config', err)
  }
}
```

**Update `saveProviderConfig`** (around line 410) — send snake_case fields:
```js
const saveProviderConfig = async () => {
  try {
    providerConfigSaving.value = true
    await setProviderConfig(projectId.value, {
      provider: providerConfig.value.provider,
      model: providerConfig.value.model,
      endpoint_url: providerConfig.value.endpoint_url,
      api_key: providerConfig.value.api_key,
      fallback_provider: providerConfig.value.fallback_provider,
    })
    providerConfigTestResult.value = null
  } catch (err) {
    console.error('Failed to save provider config', err)
    providerConfigTestResult.value = { success: false, error: err.message }
  } finally {
    providerConfigSaving.value = false
  }
}
```

**Update `testProviderConfigConnection`** (around line 430) — send api_key:
```js
const testProviderConfigConnection = async () => {
  try {
    const result = await testProviderConnection(projectId.value, {
      provider: providerConfig.value.provider,
      model: providerConfig.value.model,
      endpoint_url: providerConfig.value.endpoint_url,
      api_key: providerConfig.value.api_key,
    })
    providerConfigTestResult.value = {
      success: result.data.valid,
      latency_ms: result.data.latency_ms,
      error: result.data.message,
    }
  } catch (err) {
    providerConfigTestResult.value = { success: false, error: err.message }
  }
}
```

### Step 6: Tests

Add route ordering test for provider config API key field in `backend/src/__tests__/routeOrdering.test.js`:

```js
it('should route POST /api/v1/providers/projects/1/provider/test to providerController.testProviderConnection', async () => {
  const res = await request(app)
    .post('/api/v1/providers/projects/1/provider/test')
    .set('Authorization', 'Bearer mock-token')
    .send({ provider: 'openai', api_key: 'sk-test', model: 'gpt-4' });

  expect(res.statusCode).toBe(200);
  expect(res.body.success).toBe(true);
});
```

## Verification

1. Run database migration: `cd backend && node src/migrations/apply.js`
2. Run frontend typecheck: `cd frontend && npm run typecheck`
3. Run frontend tests: `cd frontend && npm test -- --run`
4. Run backend tests: `cd backend && npm test`
5. Manual test: Navigate to `/projects/:id` → Provider Config tab
    - Verify API key field appears for all provider types (openai, claude, ollama, vllm, llamacpp, custom)
    - Verify API key field is marked as optional
    - Enter API key, click Save, verify no errors
    - Verify saved API key is masked (first 4 + last 4 visible)
    - Click Test Connection, verify success/failure message
