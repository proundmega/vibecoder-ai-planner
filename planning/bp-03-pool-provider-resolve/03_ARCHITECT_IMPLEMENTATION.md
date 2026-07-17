# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Template

**Status**: completed
**Priority**: P1
**Effort**: Medium
**Author**: AI Assistant
**Date created**: 2026-07-12
**Date completed**: 2026-07-15
**PR**: {{link}}
**Branch**: fix/bp-03-pool-provider-resolve
**Scope**: Backend

**Dependencies**: bp-01 (providers table must exist first)

---

### a) Purpose

PoolManager resolves AI provider configuration from the global `providers` table and passes all necessary env vars to spawned agent containers. This eliminates the need for callers to manually shape provider config and ensures agents always have the correct provider type, model, and tokens.

---

### b) Actions

**Implementation Order:**

1. **Backend: ProviderService** — `backend/src/services/ProviderService.js`
   - Update `resolveProvider()` — no longer takes `projectId`
   - Query global `providers` table
   - Apply routing rules from ticket info
   - *Depends on*: nothing (bp-01 merged)

2. **Backend: PoolManager** — `backend/src/services/PoolManager.js`
   - Add `resolveProviderConfig(providerId)` — fetches and decrypts provider
   - Add `autoSelectProvider()` — finds first active worker provider
   - Update `requestAgent()` — resolve provider, pass all env vars
   - *Depends on*: Step 1

3. **Backend: Pool validator** — `backend/src/validators/pool.js`
   - Add proper schema for `provider_config`
   - *Depends on*: nothing

4. **Backend: Pool route** — `backend/src/api/pool.js`
   - Auto-resolve provider if not specified
   - Pass resolved config to PoolManager
   - *Depends on*: Step 2, 3

5. **Backend: ProvisioningService** — `backend/src/services/ProvisioningService.js`
   - Same provider resolution for remote spawn
   - *Depends on*: Step 2

6. **Tests: PoolManager** — `backend/src/__tests__/poolManager.test.js`
   - Update for new env vars
   - *Depends on*: Step 2

---

### c) Per-File Action Plan

#### `backend/src/services/ProviderService.js` (MODIFY)

Update `resolveProvider`:
```js
static async resolveProvider(ticketInfo = {}) {
  // No projectId parameter — query global providers
  const result = await db.query(`
    SELECT id, provider_type, api_key_encrypted, base_url, model,
           max_tokens, temperature, routing_rules, roles, is_active
    FROM providers
    WHERE is_active = true
    ORDER BY created_at ASC
  `);
  
  const providers = result.rows;
  if (providers.length === 0) return null;
  
  // Apply routing rules from ticketInfo
  for (const provider of providers) {
    const rules = provider.routing_rules || {};
    if (this._matchesRules(rules, ticketInfo)) {
      return this._buildProviderConfig(provider);
    }
  }
  
  // Fallback: first provider with worker role
  const worker = providers.find(p => p.roles && p.roles.includes('worker'));
  if (worker) return this._buildProviderConfig(worker);
  
  // Fallback: first active provider
  return this._buildProviderConfig(providers[0]);
}

static _matchesRules(rules, ticketInfo) {
  // Label-based routing
  if (rules.labels) {
    const ticketLabels = ticketInfo.labels || [];
    const ruleLabels = Array.isArray(rules.labels) ? rules.labels : [rules.labels];
    if (!ruleLabels.some(l => ticketLabels.includes(l))) return false;
  }
  // Priority-based routing
  if (rules.priority && ticketInfo.priority !== rules.priority) return false;
  return true;
}
```

#### `backend/src/services/PoolManager.js` (MODIFY)

Add provider resolution and update env var passing:
```js
const { decrypt } = require('../utils/encryption');

// New method
async resolveProviderConfig(providerId) {
  const result = await db.query(`
    SELECT provider_type, api_key_encrypted, base_url, model, max_tokens, temperature
    FROM providers WHERE id = $1 AND is_active = true
  `, [providerId]);
  
  if (result.rows.length === 0) {
    throw new AppError('Provider not found or inactive', 404);
  }
  
  const p = result.rows[0];
  return {
    provider_type: p.provider_type,
    api_key: decrypt(p.api_key_encrypted),
    base_url: p.base_url,
    model: p.model,
    max_tokens: p.max_tokens || 4096,
    temperature: p.temperature,
  };
}

async autoSelectProvider() {
  // Try worker role first
  let result = await db.query(`
    SELECT id, provider_type, api_key_encrypted, base_url, model, max_tokens
    FROM providers WHERE is_active = true AND 'worker' = ANY(roles)
    ORDER BY created_at ASC LIMIT 1
  `);
  
  if (result.rows.length === 0) {
    // Fallback: any active provider
    result = await db.query(`
      SELECT id, provider_type, api_key_encrypted, base_url, model, max_tokens
      FROM providers WHERE is_active = true
      ORDER BY created_at ASC LIMIT 1
    `);
  }
  
  if (result.rows.length === 0) {
    throw new AppError('No active providers configured', 400);
  }
  
  return this.resolveProviderConfig(result.rows[0].id);
}

// Update requestAgent()
async requestAgent(projectId, repoUrl, options = {}) {
  // options can be: { providerId, repoUrl }
  let providerConfig;
  
  if (options.providerId) {
    providerConfig = await this.resolveProviderConfig(options.providerId);
  } else {
    providerConfig = await this.autoSelectProvider();
  }
  
  // Build env array with ALL provider vars
  const env = [
    `BACKEND_URL=${BACKEND_URL}`,
    `API_KEY=${apiKey}`,
    `AGENT_ID=${agentId}`,
    `REPO_CLONE_DIR=/repos`,
    `AI_PROVIDER=${providerConfig.provider_type}`,
    `AI_MODEL=${providerConfig.model}`,
    `AI_API_KEY=${providerConfig.api_key}`,
    `AI_MAX_TOKENS=${providerConfig.max_tokens}`,
  ];
  
  if (providerConfig.base_url) {
    env.push(`AI_ENDPOINT_URL=${providerConfig.base_url}`);
  }
  
  // ... rest of container creation
}
```

#### `backend/src/validators/pool.js` (MODIFY)

Add proper schema:
```js
const requestAgentSchema = Joi.object({
  project_id: Joi.string().uuid().required(),
  repo_url: Joi.string().uri().allow('').optional(),
  provider_id: Joi.number().integer().positive().optional(),
  // Legacy: provider_config still accepted for backward compatibility
  provider_config: Joi.object({
    endpoint: Joi.string().uri().optional(),
    apiKey: Joi.string().optional(),
    model: Joi.string().optional(),
  }).optional(),
});
```

#### `backend/src/api/pool.js` (MODIFY)

Auto-resolve provider:
```js
router.post('/pool/request', verifyToken, requireAnyPermission('PROJECT_ADMIN'),
  validate(requestAgentSchema), async (req, res, next) => {
    const { project_id, repo_url, provider_id, provider_config } = req.body;
    
    let result;
    if (provider_id) {
      result = await poolManager.requestAgent(project_id, repo_url, { providerId: provider_id });
    } else if (provider_config) {
      // Legacy: shape provider_config for backward compat
      result = await poolManager.requestAgent(project_id, repo_url, provider_config);
    } else {
      // Auto-resolve
      result = await poolManager.requestAgent(project_id, repo_url, {});
    }
    
    res.json({ success: true, data: result });
  });
```

#### `backend/src/services/ProvisioningService.js` (MODIFY)

Add provider resolution to `spawnAgent`:
```js
async spawnAgent(nodeId, env) {
  // If env includes provider_id, resolve it
  if (env.provider_id) {
    const providerConfig = await PoolManager.resolveProviderConfig(env.provider_id);
    env.AI_PROVIDER = providerConfig.provider_type;
    env.AI_MODEL = providerConfig.model;
    env.AI_API_KEY = providerConfig.api_key;
    env.AI_MAX_TOKENS = providerConfig.max_tokens;
    if (providerConfig.base_url) {
      env.AI_ENDPOINT_URL = providerConfig.base_url;
    }
    delete env.provider_id; // Remove, replaced with individual vars
  }
  
  // ... existing SSH + docker run logic
}
```

#### `backend/src/__tests__/poolManager.test.js` (MODIFY)

Update existing test:
```js
it('includes all provider config env vars', async () => {
  // Mock db query for provider lookup
  // Call requestAgent with providerId
  // Verify env includes AI_PROVIDER, AI_MODEL, AI_API_KEY, AI_ENDPOINT_URL, AI_MAX_TOKENS
});
```

---

### d) Dependencies

- [Backend service]: `PoolManager.resolveProviderConfig()` — fetches and decrypts provider
- [Backend service]: `PoolManager.autoSelectProvider()` — finds default worker provider
- [Backend service]: `ProviderService.resolveProvider()` — global provider resolution
- [Backend route]: Pool route auto-resolves provider

---

### e) Risks/Edge Cases

- **[No providers]**: Pool request fails with 400. **Mitigation**: Clear error message.
- **[Provider in use]**: No guard against selecting a provider already assigned to an agent. Multiple agents can share a provider (intentional).
- **[Legacy provider_config]**: Old callers passing `provider_config` still work (backward compat).

---

### f) Testing

#### Backend Unit Tests
- [ ] `PoolManager.resolveProviderConfig()` returns decrypted config
- [ ] `PoolManager.autoSelectProvider()` selects worker provider
- [ ] `PoolManager.autoSelectProvider()` falls back to any provider
- [ ] `PoolManager.requestAgent()` passes all env vars
- [ ] `ProviderService.resolveProvider()` queries global providers
- [ ] Pool route auto-resolves when no provider specified

---

### g) Migration Notes

No database migrations needed — uses existing `providers` table from bp-01.

---

### h) Files Changed

**Backend:**
```
backend/src/services/ProviderService.js       → MODIFY (resolveProvider without projectId)
backend/src/services/PoolManager.js            → MODIFY (add provider resolution, all env vars)
backend/src/api/pool.js                        → MODIFY (auto-resolve provider)
backend/src/validators/pool.js                 → MODIFY (add schema)
backend/src/services/ProvisioningService.js    → MODIFY (provider resolution for remote)
backend/src/__tests__/poolManager.test.js      → MODIFY (update env var tests)
```

---

### i) Code Review Checklist

- [ ] PoolManager resolves provider from global `providers` table
- [ ] All 5 env vars passed: AI_PROVIDER, AI_MODEL, AI_API_KEY, AI_ENDPOINT_URL, AI_MAX_TOKENS
- [ ] API key decrypted server-side
- [ ] Auto-select prefers worker role
- [ ] Legacy provider_config still works
- [ ] No breaking changes to existing pool callers

---

### j) Post-Deploy Verification

1. [ ] Backend: `npm test` passes
2. [ ] Backend: `npm run lint` passes
3. [ ] Pool request without provider_id spawns agent with default provider
4. [ ] Pool request with provider_id uses specified provider
5. [ ] Container env vars include AI_PROVIDER and AI_MAX_TOKENS

---

*Fill in all sections before starting implementation.*
