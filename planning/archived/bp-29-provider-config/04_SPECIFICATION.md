# bp-29: Per-Project AI Provider Config + ProviderService — Spec

**Target model**: 14B (JavaScript + Java)
**Date**: 2026-06-27

## File Operations

### CREATE: `backend/src/migrations/020_provider_configs.sql`

```sql
CREATE TABLE provider_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    provider VARCHAR(32) NOT NULL DEFAULT 'openai',
    endpoint_url VARCHAR(512),
    model VARCHAR(128) NOT NULL,
    api_key_credential_id UUID REFERENCES credentials(id),
    fallback_provider VARCHAR(32),
    routing_rules JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(project_id, provider)
);

CREATE INDEX idx_provider_configs_project ON provider_configs(project_id);
```

### CREATE: `backend/src/services/ProviderService.js`

**Imports**:
```javascript
const db = require('../db');
const axios = require('axios');
```

**Methods**:
```javascript
async function getConfig(projectId)
  → SELECT * FROM provider_configs WHERE project_id = $1 AND is_active = true LIMIT 1

async function setConfig(projectId, { provider, endpoint_url, model, api_key_credential_id, fallback_provider })
  → INSERT INTO provider_configs (project_id, provider, endpoint_url, model, api_key_credential_id, fallback_provider)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (project_id, provider) DO UPDATE SET endpoint_url=$3, model=$4, api_key_credential_id=$5, fallback_provider=$6, updated_at=NOW()
    RETURNING *

async function deleteConfig(projectId)
  → UPDATE provider_configs SET is_active = false, updated_at = NOW() WHERE project_id = $1

async function testConnection({ endpoint_url, model, api_key })
  1. Start = Date.now()
  2. POST to ${endpoint_url}/chat/completions with { model, messages: [{role: "user", content: "Hello"}], max_tokens: 10 }
  3. If response ok → return { success: true, latency_ms: Date.now() - start }
  4. If error → return { success: false, latency_ms: Date.now() - start, error: err.message }
```

**Exports**: `module.exports = { getConfig, setConfig, deleteConfig, testConnection }`

### MODIFY: `backend/src/api/providers.js`

**Add routes** (inside the existing router with verifyToken):
```javascript
// GET /projects/:projectId/provider
router.get('/projects/:projectId/provider', verifyToken, async (req, res) => {
    const config = await providerService.getConfig(req.params.projectId);
    res.json({ success: true, data: config || null });
});

// PUT /projects/:projectId/provider
router.put('/projects/:projectId/provider', verifyToken, async (req, res) => {
    const config = await providerService.setConfig(req.params.projectId, req.body);
    res.json({ success: true, data: config });
});

// DELETE /projects/:projectId/provider
router.delete('/projects/:projectId/provider', verifyToken, async (req, res) => {
    await providerService.deleteConfig(req.params.projectId);
    res.json({ success: true, data: { deleted: true } });
});

// POST /projects/:projectId/provider/test
router.post('/projects/:projectId/provider/test', verifyToken, async (req, res) => {
    const result = await providerService.testConnection(req.body);
    res.json({ success: true, data: result });
});
```

**Import to add**: `const providerService = require('../../services/ProviderService');`

### MODIFY: `frontend/src/views/ProjectDetail.vue`

**Add to script setup**:
```javascript
import { fetchProviderConfig, setProviderConfig, testProviderConnection } from '@/api/providers';
const providerConfig = ref({ provider: 'openai', model: '', endpoint_url: '', api_key_credential_id: null });
const testResult = ref(null);
const savingProvider = ref(false);

onMounted(async () => {
    const cfg = await fetchProviderConfig(props.projectId);
    if (cfg) providerConfig.value = cfg;
});

async function saveProviderConfig() {
    savingProvider.value = true;
    await setProviderConfig(props.projectId, providerConfig.value);
    savingProvider.value = false;
}

async function testConnection() {
    testResult.value = await testProviderConnection(props.projectId, providerConfig.value);
}
```

**Add tab**: `{ id: 'provider', label: 'AI Provider' }` to tabs array.

**Add tab panel** (follow existing tab styles):
```html
<div v-if="activeTab === 'provider'" class="tab-panel">
  <div class="form-group">
    <label>Provider</label>
    <select v-model="providerConfig.provider">
      <option value="openai">OpenAI</option>
      <option value="claude">Claude</option>
      <option value="ollama">Ollama (local)</option>
      <option value="vllm">vLLM (local)</option>
      <option value="llamacpp">llama.cpp (local)</option>
    </select>
  </div>
  <div v-if="['ollama','vllm','llamacpp'].includes(providerConfig.provider)" class="form-group">
    <label>Endpoint URL</label>
    <input v-model="providerConfig.endpoint_url" placeholder="http://192.168.1.50:11434/v1" />
  </div>
  <div class="form-group">
    <label>Model</label>
    <input v-model="providerConfig.model" placeholder="gpt-4o, codellama:34b, ..." />
  </div>
  <button @click="saveProviderConfig" :disabled="savingProvider" class="btn-primary">Save Config</button>
  <button @click="testConnection" class="btn-secondary">Test Connection</button>
  <div v-if="testResult" :class="testResult.success ? 'success' : 'error'">
    {{ testResult.success ? 'Connected (' + testResult.latency_ms + 'ms)' : 'Failed: ' + testResult.error }}
  </div>
</div>
```

### MODIFY: `agent/src/.../ApiService.java`

**Add method**:
```java
public JsonNode getProviderConfig(String projectId) throws IOException {
    String url = backendUrl + "/api/v1/projects/" + projectId + "/provider";
    Request request = new Request.Builder()
        .url(url)
        .addHeader("X-API-Key", apiKey)
        .build();
    Response response = client.newCall(request).execute();
    JsonNode json = objectMapper.readTree(response.body().string());
    return json.get("data");
}
```

### MODIFY: `agent/src/.../TicketProcessor.java`

**At start of processTicket()**, add:
```java
JsonNode providerConfig = apiService.getProviderConfig(ticket.getProjectId());
String endpointUrl = providerConfig.has("endpoint_url") && !providerConfig.get("endpoint_url").isNull()
    ? providerConfig.get("endpoint_url").asText() : "";
String model = providerConfig.get("model").asText();
String provider = providerConfig.get("provider").asText();

AiProvider aiProvider;
if (!endpointUrl.isEmpty()) {
    aiProvider = new OpenAiCompatibleProvider(endpointUrl, model, AgentConfig.AI_API_KEY);
} else if ("claude".equals(provider)) {
    aiProvider = new ClaudeProvider(AgentConfig.AI_API_KEY, model);
} else {
    aiProvider = new OpenAiProvider(AgentConfig.AI_API_KEY, model);
}
```

## Test Expectations

```
✓ CRUD provider config via API creates/updates/deletes
✓ testConnection returns { success, latency_ms } for working endpoint
✓ Agent fetches project config and uses correct provider
✓ Project without config returns null from getConfig
```

## Edge Cases to Handle

1. **No config set**: getConfig returns null, agent falls back to env vars
2. **Test connection with no endpoint**: return immediately with error
3. **Config deleted while agent working**: agent uses cached config from pickup time
