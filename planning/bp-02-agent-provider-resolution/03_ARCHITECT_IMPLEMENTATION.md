# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Template

**Status**: planned
**Priority**: P1
**Effort**: Medium
**Author**: AI Assistant
**Date created**: 2026-07-12
**Date completed**: {{YYYY-MM-DD}}
**PR**: {{link}}
**Branch**: {{branch-name}}
**Scope**: Backend | Java Agent

**Dependencies**: bp-01 (providers table + agent.provider_id must exist first)

---

### a) Purpose

Java agents fetch their AI provider configuration from the backend at startup instead of reading from environment variables. This centralizes provider management and keeps API keys encrypted in the database.

---

### b) Actions

**Implementation Order:**

1. **Backend: AgentService** — `backend/src/services/AgentService.js`
   - Add `getProviderConfig(agentId)` method
   - Query agent by ID, join providers table, decrypt API key
   - Return selected fields only
   - *Depends on*: nothing (bp-01 must be merged first)

2. **Backend: AgentController** — `backend/src/controllers/agentController.js`
   - Add `getProviderConfig(req, res, next)` method
   - Call `AgentService.getProviderConfig(agentId)`
   - Return standardized response
   - *Depends on*: Step 1

3. **Backend: Agent routes** — `backend/src/api/agents.js`
   - Add `GET /:agentId/provider-config` route
   - Authenticated via existing `verifyToken` middleware
   - *Depends on*: Step 2

4. **Java Agent: ApiService** — `agent/src/main/java/.../service/ApiService.java`
   - Add `getProviderConfig(String agentId)` method
   - GET request to new backend endpoint
   - Parse JSON response, return Map<String, Object>
   - *Depends on*: Step 3

5. **Java Agent: AgentApp** — `agent/src/main/java/.../AgentApp.java`
   - Add `fetchProviderFromBackend()` method
   - Call at startup before creating AiProvider
   - Fallback to `createAiProvider()` if fetch fails
   - *Depends on*: Step 4

6. **Java Agent: AgentConfig** — `agent/src/main/java/.../config/AgentConfig.java`
   - Add deprecation comments for AI_* env vars
   - No functional changes (env vars already optional)
   - *Depends on*: nothing

7. **Java Agent: docker-compose.yml**
   - Remove AI_PROVIDER, AI_MODEL, AI_API_KEY, AI_ENDPOINT_URL from environment
   - Keep as comments showing they're optional fallbacks
   - *Depends on*: Step 5

---

### c) Per-File Action Plan

#### `backend/src/services/AgentService.js` (MODIFY)

Add method after `getAgentByApiKey`:
```js
static async getProviderConfig(agentId) {
  const result = await db.query(`
    SELECT a.id, a.name, a.provider_id,
           p.provider_type, p.api_key_encrypted, p.base_url,
           p.model, p.max_tokens, p.temperature
    FROM agents a
    LEFT JOIN providers p ON a.provider_id = p.id
    WHERE a.id = $1
  `, [agentId]);

  if (result.rows.length === 0) {
    throw new AppError('Agent not found', 404);
  }

  const agent = result.rows[0];
  if (!agent.provider_id) {
    throw new AppError('Agent has no provider configured', 404);
  }

  if (!agent.provider_type) {
    throw new AppError('Provider not found', 404);
  }

  // Decrypt API key
  const { decrypt } = require('../utils/encryption');
  const apiKey = decrypt(agent.api_key_encrypted);

  return {
    provider_type: agent.provider_type,
    api_key: apiKey,
    base_url: agent.base_url,
    model: agent.model,
    max_tokens: agent.max_tokens,
    temperature: agent.temperature,
  };
}
```

#### `backend/src/controllers/agentController.js` (CREATE or MODIFY)

If file doesn't exist, create it. If it exists, add method:
```js
async function getProviderConfig(req, res, next) {
  try {
    const agentId = req.user?.userId || req.params.agentId;
    const config = await AgentService.getProviderConfig(agentId);
    res.json({ success: true, data: config });
  } catch (err) {
    next(err);
  }
}

module.exports = { getProviderConfig };
```

#### `backend/src/api/agents.js` (MODIFY)

Add route after existing agent routes:
```js
// Get provider config for this agent
router.get('/:agentId/provider-config', verifyToken, agentController.getProviderConfig);
```

#### `agent/src/main/java/.../service/ApiService.java` (MODIFY)

Add method:
```java
public Map<String, Object> getProviderConfig(String agentId) throws IOException {
    String url = baseUrl + "/api/v1/agents/" + agentId + "/provider-config";
    ApiResponse<Map<String, Object>> response = executeGet(url,
        new TypeReference<ApiResponse<Map<String, Object>>>() {});
    
    if (response.hasError()) {
        throw new IOException("Failed to get provider config: " + response.getError());
    }
    
    return response.getData();
}
```

#### `agent/src/main/java/.../AgentApp.java` (MODIFY)

Refactor `createAiProvider()`:
```java
// Rename existing method
private AiProvider createAiProviderFromEnv() {
    // Current implementation — unchanged
}

// New method
private AiProvider fetchProviderFromBackend() {
    String agentId = config.getAgentId();
    if (agentId == null || agentId.isBlank()) {
        log.warn("No AGENT_ID set, cannot fetch provider config from backend");
        return null;
    }
    
    try {
        Map<String, Object> config = apiService.getProviderConfig(agentId);
        String type = (String) config.get("provider_type");
        String apiKey = (String) config.get("api_key");
        String baseUrl = (String) config.get("base_url");
        String model = (String) config.get("model");
        Integer maxTokens = (Integer) config.get("max_tokens");
        
        log.info("Fetched provider config from backend: type={}, model={}", type, model);
        return buildProvider(type, apiKey, baseUrl, model, maxTokens);
    } catch (Exception e) {
        log.warn("Failed to fetch provider config from backend: {}", e.getMessage());
        return null;
    }
}

private AiProvider buildProvider(String type, String apiKey, String baseUrl, 
                                  String model, Integer maxTokens) {
    if (baseUrl != null && !baseUrl.isBlank()) {
        return new OpenAiCompatibleProvider(baseUrl, model, apiKey, maxTokens);
    }
    switch (type.toLowerCase()) {
        case "openai": return new OpenAiProvider(apiKey, model);
        case "claude":
        default: return new ClaudeProvider(apiKey, model);
    }
}

// In constructor:
this.aiProvider = fetchProviderFromBackend();
if (this.aiProvider == null) {
    log.warn("Using fallback provider config from environment variables");
    this.aiProvider = createAiProviderFromEnv();
}
```

#### `agent/docker-compose.yml` (MODIFY)

Remove AI_* env vars, keep as comments:
```yaml
environment:
  - AGENT_API_KEY=${AGENT_API_KEY}
  - BACKEND_URL=${BACKEND_URL:-http://api:3001}
  - PROJECT_ID=${PROJECT_ID:-1}
  - REPO_OWNER=${REPO_OWNER}
  - REPO_NAME=${REPO_NAME}
  # AI_PROVIDER, AI_MODEL, AI_API_KEY, AI_ENDPOINT_URL are optional fallbacks
  # Provider config is fetched from backend at startup via provider_id
```

---

### d) Dependencies

- [Backend service]: `AgentService.getProviderConfig()` — fetches and decrypts provider config
- [Backend route]: `GET /api/v1/agents/:agentId/provider-config` — serves config to agents
- [Java agent]: `ApiService.getProviderConfig()` — fetches config from backend
- [Java agent]: `AgentApp` — uses fetched config at startup

---

### e) Risks/Edge Cases

- **[Backend unreachable]**: Agent can't fetch config. **Mitigation**: Falls back to env vars with warning log.
- **[Agent without provider_id]**: Returns 404. **Mitigation**: Agent falls back to env vars.
- **[Encryption key mismatch]**: Decryption fails. **Mitigation**: 500 error, agent falls back to env vars.

---

### f) Testing

#### Backend Unit Tests
- [ ] `backend/src/__tests__/agentProviderConfig.test.js` — CREATED
  - [ ] Returns provider config for agent with provider_id
  - [ ] Returns 404 for agent without provider_id
  - [ ] Returns 404 for unknown agent
  - [ ] API key is decrypted in response

#### Java Agent Testing
- [ ] Agent starts with backend-served provider config (manual)
- [ ] Agent falls back to env vars when backend is down (manual)
- [ ] Correct provider type is used (claude/openai/generic)

---

### g) Migration Notes

No database migrations needed — uses existing `providers` table and `agents.provider_id` from bp-01.

---

### h) Files Changed

**Backend:**
```
backend/src/services/AgentService.js              → MODIFY (add getProviderConfig)
backend/src/controllers/agentController.js        → CREATE or MODIFY (add getProviderConfig)
backend/src/api/agents.js                         → MODIFY (add route)
```

**Java Agent:**
```
agent/src/main/java/.../service/ApiService.java   → MODIFY (add getProviderConfig)
agent/src/main/java/.../AgentApp.java             → MODIFY (fetch provider at startup)
agent/src/main/java/.../config/AgentConfig.java   → MODIFY (add comments)
agent/docker-compose.yml                          → MODIFY (remove AI_* env vars)
```

---

### i) Code Review Checklist

- [ ] Backend: Provider config endpoint uses existing auth pattern
- [ ] Backend: API key decrypted server-side, not stored plaintext
- [ ] Backend: Only necessary fields returned (no routing_rules, no fallback_provider)
- [ ] Java: Provider config fetch handles network errors gracefully
- [ ] Java: Fallback to env vars works correctly
- [ ] Java: docker-compose.yml still functional with minimal env vars
- [ ] No new dependencies added

---

### j) Post-Deploy Verification

1. [ ] Backend: `npm test` passes
2. [ ] Backend: `npm run lint` passes
3. [ ] Java agent: `mvn clean package` compiles
4. [ ] Agent starts with only AGENT_API_KEY + BACKEND_URL
5. [ ] Agent fetches provider config and uses correct provider
6. [ ] Agent falls back to env vars when backend is unreachable

---

*Fill in all sections before starting implementation.*
