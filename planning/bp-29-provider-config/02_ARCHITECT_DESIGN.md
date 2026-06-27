# bp-29: Per-Project AI Provider Config + ProviderService — Design

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Both

## Current State

Provider config is entirely via env vars in the agent container:
```java
AI_PROVIDER = getEnv("AI_PROVIDER", "claude");
AI_MODEL = getEnv("AI_MODEL", "claude-sonnet-4-20250514");
AI_API_KEY = getEnv("AI_API_KEY", "");
AI_ENDPOINT_URL = getEnv("AI_ENDPOINT_URL", "");  // from bp-25
```

No per-project differentiation. The backend already has a `providers` route and a credential store, but the agent doesn't use them.

## Proposed Solution

### Database Table

```sql
CREATE TABLE provider_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    provider VARCHAR(32) NOT NULL DEFAULT 'openai',  -- openai, claude, ollama, vllm, llamacpp
    endpoint_url VARCHAR(512),
    model VARCHAR(128) NOT NULL,
    api_key_credential_id UUID REFERENCES credentials(id),  -- null for local models
    fallback_provider VARCHAR(32),
    routing_rules JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(project_id, provider)
);

CREATE INDEX idx_provider_configs_project ON provider_configs(project_id);
```

### ProviderService

```javascript
class ProviderService {
    async getConfig(projectId) { ... }        // Get active config for project
    async setConfig(projectId, config) { ... } // Create or update
    async deleteConfig(projectId) { ... }      // Remove config
    async testConnection(config) { ... }       // Quick test: POST a trivial prompt

    async resolveProvider(projectId, ticket) { ... }
        // Returns { endpointUrl, model, apiKey }
        // With optional fallback logic
}
```

### Agent Integration

Agent fetches config at ticket pickup time:

```java
// Instead of reading AgentConfig.* env vars:
JsonNode providerConfig = apiService.getProviderConfig(projectId);
String endpointUrl = providerConfig.get("endpoint_url").asText();
String model = providerConfig.get("model").asText();
String apiKey = fetchApiKey(providerConfig.get("api_key_credential_id"));

AiProvider provider;
if (endpointUrl != null && !endpointUrl.isEmpty()) {
    provider = new OpenAiCompatibleProvider(endpointUrl, model, apiKey);
} else if ("claude".equals(providerConfig.get("provider"))) {
    provider = new ClaudeProvider(apiKey, model);
} else {
    provider = new OpenAiProvider(apiKey, model);
}
```

### Frontend: Provider Config Tab

New tab in ProjectDetail.vue alongside Tickets, AI, GitHub, Templates:

```
Provider Config Tab:
  - Current provider: [dropdown: ollama, openai, claude, vllm, llamacpp]
  - Endpoint URL: [text input]  (shown for ollama/vllm/llamacpp)
  - Model: [text input]  (e.g. "codellama:34b", "gpt-4o")
  - API Key: [credential selector or "None (local model)"]
  - Fallback provider: [optional dropdown]
  - [Test Connection] button → shows spinner → success/fail message
  - [Save Config] button
```

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/migrations/020_provider_configs.sql` | CREATE | New table |
| `backend/src/services/ProviderService.js` | CREATE | Config CRUD + test connection |
| `backend/src/api/providers.js` | MODIFY | Add project-specific CRUD routes |
| `backend/src/api/v1/index.js` | MODIFY | Ensure provider route mounted |
| `frontend/src/api/providers.js` | MODIFY | Add provider config functions |
| `frontend/src/views/ProjectDetail.vue` | MODIFY | Add "AI Provider" tab |
| `agent/src/.../ApiService.java` | MODIFY | Add getProviderConfig method |
| `agent/src/.../TicketProcessor.java` | MODIFY | Fetch project config at pickup |

## Alternatives Considered

- **Alternative: Extend projects table with JSONB provider_config column** — Simpler but harder to query. Separate table allows future expansion (multiple providers per project with routing rules).
