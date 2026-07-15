# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: completed
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

PoolManager spawns ephemeral agent containers but doesn't resolve provider configuration — it expects the caller to pass a pre-shaped `provider_config` object. This is error-prone and doesn't integrate with the global providers table from bp-01.

---

## Current State

### PoolManager
- `requestAgent(projectId, repoUrl, providerConfig = {})` — accepts raw provider config
- Passes `providerConfig.endpoint`, `providerConfig.apiKey`, `providerConfig.model` as env vars
- **Missing**: `AI_PROVIDER` (type), `AI_MAX_TOKENS`
- Caller must know the exact key names (`endpoint` not `endpoint_url`)

### Pool Route
- `POST /pool/request` — accepts `provider_config` in body
- Validator: `Joi.object().optional()` — no schema validation
- Caller shapes the object manually

### ProviderService
- `resolveProvider(projectId, ticketInfo)` — queries `project_providers` by project_id
- Returns `{ provider, endpoint_url, api_key, model, max_tokens, ... }`
- **Needs update**: Works with per-project providers, not global

---

## Design

### Strategy: Provider resolution in PoolManager

PoolManager becomes responsible for resolving provider config. It accepts either:
1. A `providerId` — use that specific provider
2. Nothing — auto-select the first active worker provider

### Provider Resolution Flow

```
[Pool request] → [pool.js route]
    ↓
[If provider_id in body → use it]
[If not → auto-resolve: first active provider with 'worker' role]
    ↓
[PoolManager.resolveProviderConfig(providerId)]
    → SELECT from providers table
    → Decrypt API key
    → Return { provider_type, api_key, base_url, model, max_tokens }
    ↓
[PoolManager.requestAgent() builds env array with ALL provider vars]
```

### Env Var Mapping

| Provider Field | Env Var | Notes |
|---------------|---------|-------|
| `provider_type` | `AI_PROVIDER` | claude, openai, or generic (for OpenAiCompatibleProvider) |
| `model` | `AI_MODEL` | e.g., claude-sonnet-4-20250514 |
| `api_key` (decrypted) | `AI_API_KEY` | Plaintext key for container |
| `base_url` | `AI_ENDPOINT_URL` | null → not set (agent uses built-in URLs) |
| `max_tokens` | `AI_MAX_TOKENS` | Default 4096 from provider config |

### ProviderAutoSelect Logic

```js
async function autoSelectProvider() {
  // Try worker role first
  const result = await db.query(`
    SELECT id, provider_type, model, api_key_encrypted, base_url, max_tokens
    FROM providers
    WHERE is_active = true AND 'worker' = ANY(roles)
    ORDER BY created_at ASC
    LIMIT 1
  `);
  
  if (result.rows.length > 0) return result.rows[0];
  
  // Fallback: any active provider
  const result2 = await db.query(`
    SELECT id, provider_type, model, api_key_encrypted, base_url, max_tokens
    FROM providers
    WHERE is_active = true
    ORDER BY created_at ASC
    LIMIT 1
  `);
  
  if (result2.rows.length === 0) throw new AppError('No active providers configured', 400);
  return result2.rows[0];
}
```

### ProviderService.update

`resolveProvider(ticketInfo)` — no longer takes `projectId`. Queries global providers:

```js
static async resolveProvider(ticketInfo) {
  // Apply routing rules from ticketInfo (labels, priority)
  // Return first matching provider from global providers table
  // Falls back to first active worker provider
}
```

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/services/PoolManager.js` | MODIFY | Add `resolveProviderConfig()`, pass all env vars |
| `backend/src/services/ProviderService.js` | MODIFY | `resolveProvider()` without projectId |
| `backend/src/api/pool.js` | MODIFY | Auto-resolve provider, pass to PoolManager |
| `backend/src/validators/pool.js` | MODIFY | Add proper schema for provider_config |
| `backend/src/services/ProvisioningService.js` | MODIFY | Same provider resolution |
| `backend/src/__tests__/poolManager.test.js` | MODIFY | Update for new env vars |

---

## Security Considerations

- Provider API key decrypted server-side, passed to container (necessary for agent to use it)
- Pool requests require PROJECT_ADMIN permission (existing)
- Only active providers (`is_active = true`) can be selected

---

## Risks and Edge Cases

- **[No providers exist]**: Pool request fails with 400. **Mitigation**: Clear error message.
- **[Provider deleted during spawn]**: FK constraint prevents this (providers must exist).
- **[Multiple worker providers]**: First created is used. Operator controls priority via creation order.

---

## Alternative Designs Considered

### Alternative 1: Resolve provider in pool.js route, not PoolManager

Route handler does the provider lookup, passes resolved config to PoolManager.

- **Pros**: Route layer controls business logic
- **Cons**: PoolManager should own its spawn logic; route should just validate input
- **Decision**: Resolution in PoolManager keeps business logic with the service that uses it.

### Alternative 2: Always require provider_id in pool requests

Don't auto-resolve; caller must specify.

- **Pros**: Explicit, no ambiguity
- **Cons**: Callers must know provider IDs; defeats the purpose of having a default
- **Decision**: Auto-resolve with explicit override via `provider_id`.

---

*This design document guides implementation.*
