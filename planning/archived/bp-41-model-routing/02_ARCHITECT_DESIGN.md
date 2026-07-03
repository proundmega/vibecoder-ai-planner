# bp-41: Per-Ticket Model Routing — Design

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Both (backend + agent)

## Current State

- `project_providers` table stores: project_id, provider_type, api_key_encrypted, base_url, model, roles, max_tokens, temperature
- `ProviderRouter.js` loads providers and routes by role (worker/admin)
- Agent's `TicketProcessor.java` uses `AiProvider` (ClaudeProvider/OpenAiProvider) configured via AgentConfig env vars
- Agent ignores project-level provider routing — uses hardcoded model from env
- No concept of "this bug fix should use cheap model, this feature should use expensive model"

## Proposed Solution

### Routing Rules Schema

Add `routing_rules` JSONB column to `project_providers`:

```json
{
  "rules": [
    {
      "match": { "labels": ["bug", "typo"] },
      "provider": "ollama",
      "endpoint_url": "http://ollama:11434",
      "model": "codellama:7b"
    },
    {
      "match": { "priority": "low" },
      "provider": "ollama",
      "endpoint_url": "http://ollama:11434",
      "model": "qwen2.5-coder:14b"
    },
    {
      "match": { "labels": ["feature", "architecture"] },
      "provider": "claude",
      "model": "claude-sonnet-4-20250514"
    }
  ],
  "fallback": {
    "provider": "openai",
    "endpoint_url": "https://api.openai.com/v1",
    "model": "gpt-4o"
  }
}
```

### Rule Evaluation Algorithm

```javascript
resolveProvider(projectId, ticket) {
  const config = await this.getProjectProvider(projectId);
  if (!config.routing_rules || !config.routing_rules.rules) {
    return this._defaultProvider(config);
  }

  const ticketLabels = new Set(ticket.labels || []);
  const ticketPriority = ticket.priority;

  for (const rule of config.routing_rules.rules) {
    if (this._matches(rule.match, ticketLabels, ticketPriority)) {
      // Merge rule config with project provider defaults
      return this._mergeConfig(config, rule);
    }
  }

  // No match — use fallback from routing_rules or project default
  if (config.routing_rules.fallback) {
    return this._mergeConfig(config, config.routing_rules.fallback);
  }
  return this._defaultProvider(config);
}

_matches(match, ticketLabels, ticketPriority) {
  if (match.labels) {
    const requiredLabels = new Set(match.labels);
    let matched = false;
    for (const label of ticketLabels) {
      if (requiredLabels.has(label)) { matched = true; break; }
    }
    if (!matched) return false;
  }
  if (match.priority && match.priority !== ticketPriority) return false;
  return true;
}
```

### Agent Integration Flow

```
Agent picks up ticket
  │
  ├─ 1. Call POST /api/v1/projects/:id/provider/resolve
  │    Body: { ticket_id, labels: ["bug"], priority: "high", phase: "backlog" }
  │    Response: { provider: "ollama", endpoint_url: "...", model: "codellama:7b", api_key: "..." }
  │
  ├─ 2. Configure AiProvider with resolved endpoint_url + model + api_key
  │    (Instead of default AgentConfig env vars)
  │
  ├─ 3. Generate AI content using configured provider
  │
  └─ 4. If AI call fails → retry with fallback from routing_rules
       (Backend returns fallback config, agent can re-request or use cached)
```

### HTTP API

```http
POST /api/v1/projects/:projectId/provider/resolve
Authorization: Bearer <agent-token>
Content-Type: application/json

{
  "ticket_id": "uuid",
  "labels": ["bug", "ui"],
  "priority": "high",
  "phase": "backlog",
  "title": "Fix button alignment in header"
}

Response 200:
{
  "success": true,
  "data": {
    "provider": "ollama",
    "endpoint_url": "http://ollama:11434/v1",
    "model": "codellama:7b",
    "api_key": "sk-test-...",
    "is_fallback": false
  }
}
```

The `api_key` field is included so the agent can make direct API calls without needing the backend as proxy. The agent's existing `AiProvider` implementations already accept API key + endpoint + model.

### Fallback Strategy

When the resolved provider call fails in the agent:
1. Agent catches the error
2. Agent re-calls resolve endpoint with `?include_fallback=true` or simply calls again
3. Backend returns the fallback provider from routing_rules
4. Agent retries AI generation with fallback
5. If fallback also fails → agent releases ticket with error

### Alternatives Considered

- **Option B: Proxy all AI calls through backend** — Adds latency, bandwidth cost. Agent makes direct API calls using resolved config.
- **Option C: Agent-side routing** — Agent would need full routing rules + all API keys. Security concern.

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/migrations/028_routing_rules.sql` | CREATE | ALTER TABLE project_providers ADD COLUMN routing_rules JSONB |
| `backend/src/services/ProviderService.js` | CREATE | Service with resolveProvider(), _matches(), _mergeConfig() |
| `backend/src/api/providers.js` | MODIFY | Add POST /:projectId/provider/resolve endpoint |
| `agent/.../ApiService.java` | MODIFY | Add resolveProvider(Ticket ticket) method |
| `agent/.../TicketProcessor.java` | MODIFY | Call resolveProvider at pickup, use resolved config |
| `agent/.../AiProvider.java` | MODIFY | Accept dynamic config (endpoint, model, key) in generate() |

## Dependencies

- **Depends on**: bp-29 (Provider Config) — project_providers table exists
- **Depends on**: bp-25 (AI Endpoint URL) — agent supports configurable endpoint URLs

## Performance Considerations

- Rule evaluation is O(n) where n = number of rules. Typical: 3-5 rules.
- Rule matching uses Set lookups — O(1) per label check.
- The resolve endpoint is called once per ticket pickup — negligible overhead.
