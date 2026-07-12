# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend | Java Agent
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

Java agents currently read AI provider configuration from environment variables. This means:
- API keys are exposed in container env vars and docker-compose files
- Changing a provider requires rebuilding/redeploying the agent
- No central source of truth for provider configuration

After bp-01, agents have a `provider_id` linking to a global `providers` record. The agent should fetch its config from the backend.

---

## Current State

### Backend
- `agents` table has `provider_id` FK → `providers.id` (from bp-01)
- `providers` table has `api_key_encrypted`, `base_url`, `model`, `provider_type`, `max_tokens`
- `AgentService.getAgentByApiKey(apiKey)` returns agent record with provider_id
- No endpoint exists to serve decrypted provider config to agents

### Java Agent
- `AgentConfig.java` reads `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`, `AI_ENDPOINT_URL` from env vars
- `AgentApp.createAiProvider()` builds provider instance from env vars
- `ApiService.getDecryptedKey()` exists but is **never called** (dead code)
- Agent authenticates to backend with `X-API-Key: AGENT_API_KEY`

---

## Design

### Backend: New Endpoint

```
GET /api/v1/agents/:agentId/provider-config
Auth: X-API-Key header (agent's own API key)
```

**Flow:**
1. `verifyToken` middleware authenticates request via X-API-Key
2. Extract `agentId` from `req.params.agentId` (or use authenticated user)
3. `AgentService.getProviderConfig(agentId)`:
   a. Find agent by API key (or by ID if already authenticated)
   b. Check `provider_id` is set
   c. JOIN `providers` table to get provider config
   d. Decrypt `api_key_encrypted`
   e. Return selected fields

**Response shape:**
```json
{
  "success": true,
  "data": {
    "provider_type": "claude",
    "api_key": "sk-ant-...",
    "base_url": null,
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 4096,
    "temperature": 0.1
  }
}
```

**Error cases:**
- Agent not found → 404
- Agent has no provider_id → 404
- Provider not found → 404
- Decryption fails → 500

### Java Agent: Provider Config Fetch

**New method in `ApiService.java`:**
```java
public Map<String, Object> getProviderConfig(String agentId) throws IOException {
    String url = baseUrl + "/api/v1/agents/" + agentId + "/provider-config";
    // GET with X-API-Key header
    // Parse response, extract data field
    // Return as Map<String, Object>
}
```

**Changes to `AgentApp.java`:**
```java
public AgentApp(AgentConfig config) {
    this.config = config;
    this.apiService = new ApiService(config);
    
    // Try to fetch provider config from backend
    AiProvider provider = fetchProviderFromBackend();
    if (provider == null) {
        // Fallback to env vars
        log.warn("Failed to fetch provider config from backend, falling back to env vars");
        provider = createAiProviderFromEnv();
    }
    this.aiProvider = provider;
    
    this.gitHubService = new GitHubService(...);
    this.ticketProcessor = new TicketProcessor(config, apiService, aiProvider, gitHubService);
}

private AiProvider fetchProviderFromBackend() {
    try {
        Map<String, Object> providerConfig = apiService.getProviderConfig(config.getAgentId());
        String type = (String) providerConfig.get("provider_type");
        String apiKey = (String) providerConfig.get("api_key");
        String model = (String) providerConfig.get("model");
        String baseUrl = (String) providerConfig.get("base_url");
        int maxTokens = (int) providerConfig.get("max_tokens");
        
        // Build provider from fetched config (same logic as createAiProvider but from map)
        return buildProvider(type, apiKey, baseUrl, model, maxTokens);
    } catch (Exception e) {
        log.warn("Failed to fetch provider config: {}", e.getMessage());
        return null;
    }
}
```

**Changes to `AgentConfig.java`:**
- Make `aiApiKey`, `aiEndpointUrl`, `aiProvider`, `aiModel` optional (already are, defaults exist)
- Add comment: "These env vars are deprecated — provider config is fetched from backend at startup"

### Data Flow

```
[Agent Startup]
    ↓
[AgentConfig reads AGENT_API_KEY, BACKEND_URL, AGENT_ID]
    ↓
[ApiService.getProviderConfig(agentId)]
    → GET /api/v1/agents/:agentId/provider-config
    → X-API-Key: AGENT_API_KEY
    ↓
[Backend: verifyToken → AgentService.getProviderConfig → decrypt → return]
    ↓
[Agent receives { provider_type, api_key, model, base_url, max_tokens }]
    ↓
[AgentApp builds AiProvider from fetched config]
    ↓
[TicketProcessor uses aiProvider for AI calls]
```

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/api/agents.js` | MODIFY | Add `GET /:agentId/provider-config` route |
| `backend/src/controllers/agentController.js` | CREATE (or extend) | New `getProviderConfig` method |
| `backend/src/services/AgentService.js` | MODIFY | New `getProviderConfig(agentId)` method |
| `agent/src/main/java/.../service/ApiService.java` | MODIFY | Add `getProviderConfig(agentId)` method |
| `agent/src/main/java/.../AgentApp.java` | MODIFY | Fetch provider config at startup, fallback to env vars |
| `agent/src/main/java/.../config/AgentConfig.java` | MODIFY | Add deprecation comments for AI_* env vars |
| `agent/docker-compose.yml` | MODIFY | Remove AI_* env vars (keep as optional fallback) |

---

## Security Considerations

- Agent authenticates with its own API key (existing pattern)
- Agent can only fetch its own provider config
- API key is decrypted server-side, sent plaintext to agent (necessary — agent needs it)
- No other sensitive fields returned (no routing_rules, no fallback_provider)

---

## Risks and Edge Cases

### Risks
- **[Network dependency]**: Agent needs backend reachable at startup. **Mitigation**: Env var fallback.
- **[Decryption failure]**: If encryption key is wrong, provider config can't be decrypted. **Mitigation**: Clear 500 error, agent falls back to env vars.

### Edge Cases
- [ ] **Agent created without provider_id**: Returns 404, agent falls back to env vars
- [ ] **Provider deleted after agent created**: FK `ON DELETE SET NULL` → provider_id becomes null → 404
- [ ] **Multiple agents with same provider**: Each agent fetches independently, no conflict
- [ ] **Backend temporarily unavailable**: Agent logs warning, uses env vars

---

## Alternative Designs Considered

### Alternative 1: Agent polls for config periodically

Agent refreshes provider config every N minutes.

- **Pros**: Dynamic config changes without restart
- **Cons**: Adds complexity, unnecessary for current needs (config changes are rare)
- **Decision**: Not chosen. Fetch at startup is simpler and sufficient.

### Alternative 2: Backend pushes config to agent

Backend sends config via WebSocket or webhook when provider changes.

- **Pros**: True real-time updates
- **Cons**: Major architecture change, WebSocket infrastructure needed
- **Decision**: Not chosen. Over-engineering for current needs.

---

*This design document guides implementation.*
