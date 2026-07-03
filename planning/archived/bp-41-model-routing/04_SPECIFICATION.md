# bp-41: Per-Ticket Model Routing — Spec

**Target model**: 14B–34B (Express.js + Java)
**Date**: 2026-06-27

## File Operations

### CREATE: `backend/src/migrations/028_routing_rules.sql`
```sql
-- Migration: 028_routing_rules.sql
ALTER TABLE project_providers ADD COLUMN IF NOT EXISTS routing_rules JSONB DEFAULT NULL;

COMMENT ON COLUMN project_providers.routing_rules IS
  'Rule-based model routing: { "rules": [{ "match": { "labels": [], "priority": "" }, "provider": "", "endpoint_url": "", "model": "" }], "fallback": { ... } }';
```

### CREATE: `backend/src/services/ProviderService.js`

**Full implementation**:

```javascript
const { pool } = require('../db');
const { decrypt } = require('../utils/crypto');

class ProviderService {

  async getProjectProvider(projectId) {
    const result = await pool.query(
      `SELECT * FROM project_providers
       WHERE project_id = $1 AND is_active = true
       ORDER BY created_at DESC LIMIT 1`,
      [projectId]
    );
    return result.rows[0] || null;
  }

  async resolveProvider(projectId, ticketInfo) {
    const config = await this.getProjectProvider(projectId);
    if (!config) {
      throw new Error('No active provider configuration found for this project');
    }

    const rules = config.routing_rules;
    if (!rules || !Array.isArray(rules.rules) || rules.rules.length === 0) {
      return this._defaultProvider(config);
    }

    const ticketLabels = new Set(ticketInfo.labels || []);
    const ticketPriority = ticketInfo.priority || 'medium';

    for (const rule of rules.rules) {
      if (this._matches(rule.match, ticketLabels, ticketPriority)) {
        return this._buildProviderConfig(config, rule, false);
      }
    }

    // Fallback
    if (rules.fallback) {
      return this._buildProviderConfig(config, rules.fallback, true);
    }

    return this._defaultProvider(config);
  }

  _matches(match, ticketLabels, ticketPriority) {
    if (!match) return true;

    if (match.labels && Array.isArray(match.labels) && match.labels.length > 0) {
      const requiredLabels = new Set(match.labels);
      let matched = false;
      for (const label of ticketLabels) {
        if (requiredLabels.has(label)) {
          matched = true;
          break;
        }
      }
      if (!matched) return false;
    }

    if (match.priority && match.priority !== ticketPriority) {
      return false;
    }

    return true;
  }

  _buildProviderConfig(baseConfig, ruleConfig, isFallback) {
    const apiKey = ruleConfig.api_key
      ? ruleConfig.api_key
      : decrypt(baseConfig.api_key_encrypted);

    return {
      provider: ruleConfig.provider || baseConfig.provider_type,
      endpoint_url: ruleConfig.endpoint_url || baseConfig.base_url || null,
      model: ruleConfig.model || baseConfig.model,
      api_key: apiKey,
      max_tokens: ruleConfig.max_tokens || baseConfig.max_tokens || 4096,
      temperature: ruleConfig.temperature !== undefined
        ? ruleConfig.temperature
        : (baseConfig.temperature || 0.1),
      is_fallback: isFallback,
    };
  }

  _defaultProvider(config) {
    return {
      provider: config.provider_type,
      endpoint_url: config.base_url || null,
      model: config.model,
      api_key: decrypt(config.api_key_encrypted),
      max_tokens: config.max_tokens || 4096,
      temperature: config.temperature || 0.1,
      is_fallback: false,
    };
  }
}

module.exports = new ProviderService();
```

### MODIFY: `backend/src/api/providers.js`

**Add route** (before `module.exports = router;`):

```javascript
const ProviderService = require('../services/ProviderService');

/**
 * @openapi
 * /providers/{projectId}/provider/resolve:
 *   post:
 *     tags: [Providers]
 *     summary: Resolve AI provider for a ticket based on routing rules
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ticket_id: { type: string }
 *               labels: { type: array, items: { type: string } }
 *               priority: { type: string }
 *               phase: { type: string }
 *     responses:
 *       200:
 *         description: Resolved provider config
 */
router.post('/:projectId/provider/resolve', verifyToken, async (req, res, next) => {
  try {
    const ticketInfo = {
      labels: req.body.labels || [],
      priority: req.body.priority || 'medium',
      phase: req.body.phase || 'backlog',
    };
    const config = await ProviderService.resolveProvider(req.params.projectId, ticketInfo);
    res.json({ success: true, data: config });
  } catch (err) {
    next(err);
  }
});
```

### MODIFY: `agent/src/.../service/ApiService.java`

**Add method**:

```java
public Map<String, Object> resolveProvider(Long ticketId, List<String> labels,
    String priority, String phase) throws IOException {
  String url = baseUrl + "/providers/" + config.getProjectId() + "/provider/resolve";

  Map<String, Object> body = new HashMap<>();
  body.put("ticket_id", ticketId);
  body.put("labels", labels != null ? labels : Collections.emptyList());
  body.put("priority", priority != null ? priority : "medium");
  body.put("phase", phase != null ? phase : "backlog");

  ApiResponse<Map<String, Object>> response = executePost(url, body,
      new TypeReference<ApiResponse<Map<String, Object>>>() {});

  if (response.hasError()) {
    throw new IOException("Provider resolution failed: " + response.getError());
  }
  return response.getData();
}
```

### MODIFY: `agent/src/.../service/TicketProcessor.java`

**Modified `processTicket()` flow**:

```java
public void processTicket(Ticket ticket) {
  log.info("Processing ticket: {} - {}", ticket.getId(), ticket.getTitle());

  // Step 1: Pick up
  Ticket pickedUp = pickUpTicket(ticket.getId());
  if (pickedUp == null) return;

  try {
    // Step 1.5: Resolve provider
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
      log.warn("Provider resolution failed, using defaults: {}", e.getMessage());
    }

    // Step 2: Generate AI content
    String generatedContent = null;
    if (!config.isDryRun()) {
      if (providerConfig != null) {
        String endpoint = (String) providerConfig.get("endpoint_url");
        String model = (String) providerConfig.get("model");
        String apiKey = (String) providerConfig.get("api_key");
        generatedContent = aiProvider.generate(pickedUp, endpoint, model, apiKey);
      } else {
        generatedContent = aiProvider.generate(pickedUp);
      }
      log.info("AI generated content for ticket {}", ticket.getId());
    }

    // ... rest of existing flow (branch, commit, PR) ...
  } catch (Exception e) {
    log.error("Failed to process ticket {}: {}", ticket.getId(), e.getMessage());
    apiService.postMessage(pickedUp.getId(), "error",
        "Failed: " + e.getMessage());
    apiService.releaseTicket(pickedUp.getId());
  }
}
```

### MODIFY: `agent/src/.../service/ClaudeProvider.java`

**Add overloaded generate**:

```java
@Override
public String generate(Ticket ticket, String endpointUrl, String model, String apiKey) throws IOException {
  String resolvedEndpoint = endpointUrl != null ? endpointUrl : CLAUDE_DEFAULT_ENDPOINT;
  String resolvedModel = model != null ? model : config.getAiModel();
  String resolvedKey = apiKey != null ? apiKey : config.getAiApiKey();

  // Build request body with resolvedModel
  String requestBody = buildClaudeRequest(ticket, resolvedModel);

  Request request = new Request.Builder()
      .url(resolvedEndpoint + "/messages")
      .header("x-api-key", resolvedKey)
      .header("anthropic-version", "2023-06-01")
      .header("Content-Type", "application/json")
      .post(RequestBody.create(requestBody, MediaType.get("application/json")))
      .build();

  try (Response response = httpClient.newCall(request).execute()) {
    if (!response.isSuccessful()) {
      String errorBody = response.body() != null ? response.body().string() : "unknown";
      // If 429 or 5xx AND model uses fallback, throw to trigger retry
      if (response.code() >= 500 || response.code() == 429) {
        throw new IOException("Provider error " + response.code() + ": " + errorBody);
      }
      throw new IOException("Claude API error " + response.code() + ": " + errorBody);
    }
    return parseClaudeResponse(response.body().string());
  }
}
```

### MODIFY: `agent/src/.../service/OpenAiProvider.java`

**Same pattern** — add overloaded generate that accepts endpointUrl, model, apiKey parameters.

## Test Expectations

### Backend
```
✓ resolveProvider with matching labels → returns correct model
✓ resolveProvider with matching priority → returns correct model
✓ resolveProvider with no match → returns fallback or default
✓ resolveProvider with no routing_rules → returns default
✓ resolveProvider with empty rules → returns default
✓ Match priority=high with rule match priority=high → matched
✓ Match priority=high with rule match priority=low → not matched
✓ Multiple rules: first match wins (top-to-bottom)
✓ API endpoint returns valid provider config JSON
```

### Agent
```
✓ resolveProvider called after pickup, before AI generation
✓ Provider config used in AiProvider.generate() call
✓ If resolveProvider fails → falls back to env-var defaults
✓ If primary AI call fails with 5xx → uses fallback config
✓ Logs resolved provider and model for debugging
```

## Edge Cases to Handle

1. **No active provider**: resolveProvider throws "No active provider" → agent uses defaults
2. **Rule with no match field**: treated as catch-all, always matches
3. **Labels array empty in ticket**: rules with label requirements won't match
4. **Fallback also fails**: agent releases ticket with error (not infinite retry)
5. **Routing rules updated mid-flight**: Not a concern — resolved once per ticket pickup
6. **API key rotation**: Agent gets current key from resolve endpoint each time — always fresh
7. **Provider endpoint unreachable**: Falls back via is_fallback flag → agent retries with fallback

## Existing Code Patterns to Follow

- Backend service as singleton class instance (`module.exports = new ProviderService()`)
- Express route handlers wrapped in try/catch with `next(err)` for error middleware
- Java: OkHttp for HTTP calls, Jackson for JSON parsing
- Java: SLF4J Logger for all logging
- API response: `{ success: true, data: ... }`
- Agent uses TypeReference with ApiResponse wrapper for all API calls
- Migration uses `IF NOT EXISTS` / `IF NOT NULL` for safety
