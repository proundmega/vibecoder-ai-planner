# bp-41: Per-Ticket Model Routing — Implementation

**Status**: planned
**Priority**: P2
**Effort**: Medium
**Scope**: Both (backend + agent)

## Purpose
Route each ticket to the appropriate AI model based on labels and priority, with fallback on failure.

## Implementation Order

1. **Migration 028** — Add routing_rules JSONB column to project_providers
2. **Create ProviderService.js** — Rule evaluation + config resolution
3. **Modify providers.js API** — Add resolve endpoint
4. **Modify ApiService.java** — Add resolveProvider() method
5. **Modify AiProvider.java** — Accept dynamic config per call
6. **Modify TicketProcessor.java** — Call resolve at pickup

## Per-File Action Plan

### `backend/src/migrations/028_routing_rules.sql` (CREATE)
```sql
-- Migration: 028_routing_rules.sql
ALTER TABLE project_providers ADD COLUMN IF NOT EXISTS routing_rules JSONB DEFAULT NULL;

COMMENT ON COLUMN project_providers.routing_rules IS 'JSON: { rules: [{ match: { labels?: [], priority?: string }, provider, endpoint_url?, model }], fallback?: { provider, endpoint_url?, model } }';
```

### `backend/src/services/ProviderService.js` (CREATE)

Full service class:

```javascript
const { pool } = require('../db');
const { decrypt } = require('../utils/crypto');

class ProviderService {
  async getProjectProvider(projectId) {
    const result = await pool.query(
      'SELECT * FROM project_providers WHERE project_id = $1 AND is_active = true LIMIT 1',
      [projectId]
    );
    return result.rows[0] || null;
  }

  async resolveProvider(projectId, ticket) {
    const config = await this.getProjectProvider(projectId);
    if (!config) throw new Error('No active provider config for project');

    const rules = config.routing_rules;
    if (!rules || !Array.isArray(rules.rules) || rules.rules.length === 0) {
      return this._defaultConfig(config);
    }

    const ticketLabels = new Set(ticket.labels || []);
    const ticketPriority = ticket.priority;

    for (const rule of rules.rules) {
      if (this._matches(rule.match, ticketLabels, ticketPriority)) {
        return this._buildConfig(config, rule);
      }
    }

    // Fallback
    if (rules.fallback) {
      return this._buildConfig(config, rules.fallback, true);
    }

    return this._defaultConfig(config);
  }

  _matches(match, ticketLabels, ticketPriority) {
    if (!match) return true;
    if (match.labels && match.labels.length > 0) {
      const required = new Set(match.labels);
      let found = false;
      for (const label of ticketLabels) {
        if (required.has(label)) { found = true; break; }
      }
      if (!found) return false;
    }
    if (match.priority && match.priority !== ticketPriority) return false;
    return true;
  }

  _buildConfig(baseConfig, ruleConfig, isFallback = false) {
    const apiKey = ruleConfig.api_key
      ? ruleConfig.api_key
      : decrypt(baseConfig.api_key_encrypted);

    return {
      provider: ruleConfig.provider || baseConfig.provider_type,
      endpoint_url: ruleConfig.endpoint_url || baseConfig.base_url || null,
      model: ruleConfig.model || baseConfig.model,
      api_key: apiKey,
      is_fallback: isFallback,
    };
  }

  _defaultConfig(baseConfig) {
    return {
      provider: baseConfig.provider_type,
      endpoint_url: baseConfig.base_url || null,
      model: baseConfig.model,
      api_key: decrypt(baseConfig.api_key_encrypted),
      is_fallback: false,
    };
  }
}

module.exports = new ProviderService();
```

### `backend/src/api/providers.js` (MODIFY)

Add route after existing routes:

```javascript
const ProviderService = require('../services/ProviderService');

// POST /api/v1/providers/:projectId/provider/resolve
router.post('/:projectId/provider/resolve', verifyToken, async (req, res, next) => {
  try {
    const ticket = {
      labels: req.body.labels || [],
      priority: req.body.priority || 'medium',
      phase: req.body.phase || 'backlog',
    };
    const config = await ProviderService.resolveProvider(req.params.projectId, ticket);
    // Mask the API key partially for response
    const maskedKey = config.api_key
      ? config.api_key.substring(0, 8) + '...' + config.api_key.slice(-4)
      : null;
    res.json({
      success: true,
      data: { ...config, api_key: config.api_key },
    });
  } catch (err) {
    next(err);
  }
});
```

Note: The full API key is sent to the agent (which is authenticated via agent token). The masked version is a comment placeholder — the agent needs the real key.

### `agent/src/.../ApiService.java` (MODIFY)

Add method:

```java
public Map<String, Object> resolveProvider(Long ticketId, List<String> labels, String priority, String phase) throws IOException {
    String url = baseUrl + "/providers/" + config.getProjectId() + "/provider/resolve";
    
    Map<String, Object> body = new HashMap<>();
    body.put("ticket_id", ticketId);
    body.put("labels", labels);
    body.put("priority", priority);
    body.put("phase", phase);
    
    ApiResponse<Map<String, Object>> response = executePost(url, body,
        new TypeReference<ApiResponse<Map<String, Object>>>() {});
    
    if (response.hasError()) {
        throw new IOException("Failed to resolve provider: " + response.getError());
    }
    return response.getData();
}
```

### `agent/src/.../TicketProcessor.java` (MODIFY)

In `processTicket()`, after pickup and before AI generation:

```java
import java.util.Map;

// In processTicket(), add after pickup:
Map<String, Object> providerConfig = null;
try {
    providerConfig = apiService.resolveProvider(
        pickedUp.getId(),
        pickedUp.getLabels(),
        pickedUp.getPriority(),
        pickedUp.getPhase()
    );
    log.info("Resolved provider: {} model: {}", 
        providerConfig.get("provider"), providerConfig.get("model"));
} catch (IOException e) {
    log.warn("Failed to resolve provider, using default: {}", e.getMessage());
}

// Then in AI generation step, pass resolved config:
String generatedContent;
if (providerConfig != null) {
    generatedContent = aiProvider.generate(
        pickedUp,
        (String) providerConfig.get("endpoint_url"),
        (String) providerConfig.get("model"),
        (String) providerConfig.get("api_key")
    );
} else {
    generatedContent = aiProvider.generate(pickedUp);
}
```

### `agent/src/.../AiProvider.java` (MODIFY)

Add overloaded `generate()` method:

```java
// Existing: uses AgentConfig defaults
public String generate(Ticket ticket) throws IOException;

// New: uses dynamic config
default String generate(Ticket ticket, String endpointUrl, String model, String apiKey) throws IOException {
    // Default implementation calls the parameterized version
    return generate(ticket);
}
```

Implement in ClaudeProvider and OpenAiProvider:

```java
// ClaudeProvider.java
@Override
public String generate(Ticket ticket, String endpointUrl, String model, String apiKey) throws IOException {
    // Use endpointUrl instead of DEFAULT_ENDPOINT
    // Use model instead of config.getAiModel()
    // Use apiKey instead of config.getAiApiKey()
    RequestBody requestBody = buildRequestBody(ticket, model);
    Request request = new Request.Builder()
        .url(endpointUrl != null ? endpointUrl : DEFAULT_ENDPOINT)
        .header("x-api-key", apiKey != null ? apiKey : config.getAiApiKey())
        .header("anthropic-version", "2023-06-01")
        .post(requestBody)
        .build();
    // ... rest of existing logic
}
```

## Migration Plan
Single migration 028 — safe ALTER TABLE ADD COLUMN IF NOT EXISTS.

## Test Plan
1. Create project provider with routing_rules
2. Submit ticket with matching labels → verify correct model resolved
3. Submit ticket with no matching rules → verify project default returned
4. Submit ticket with matching priority → verify correct model
5. Set fallback → verify returned when no rules match
6. No routing_rules → verify default config returned
7. Agent integration: mock resolve endpoint, verify agent uses returned config

## Rollback Steps
1. Run 028_rollback.sql: ALTER TABLE project_providers DROP COLUMN routing_rules
2. Remove ProviderService.js
3. Revert backend API changes
4. Revert agent Java changes
