# bp-119: Runtime Provider Config Hot Reload

## Ticket Information
- **ID**: bp-119
- **Priority**: P3 (feature enhancement)
- **Type**: Feature
- **Scope**: Backend + Java Agent

## Problem Statement

The Java agent fetches provider configuration from the backend **once at startup** via `GET /api/v1/agents/:agentId/provider-config`. After that, the `AiProvider` instance is immutable. If an admin changes the provider configuration (model, API key, endpoint) in the frontend, the agent continues using the old config until it is restarted.

### Current Flow

```
Agent starts → fetch provider config → create AiProvider → run forever
                                                                    ↑
Admin changes provider config → agent uses OLD config until restart
```

## Solution

### Backend: Add Provider Cache with Invalidation

Follow the `PermissionService` caching pattern (Redis + in-memory):

1. Add Redis caching to `ProviderService.getProjectProviders()` with 5-minute TTL
2. Add `invalidateProviderCache()` method (invalidate all or by project_id)
3. Call invalidation on `POST/PUT/DELETE /providers` endpoints

### Backend: Add Provider Change Notification

1. Add `GET /api/v1/agents/:agentId/provider-config/changed?since=<timestamp>` endpoint
2. Returns `{ success: true, data: { changed: true/false, config: {...} } }`
3. Agent polls this endpoint every 60 seconds

### Java Agent: Add Config Polling

1. Add a background thread that polls `provider-config/changed` every 60 seconds
2. If `changed: true`, recreate the `AiProvider` instance with new config
3. Log config changes for observability

## Implementation Plan

### 1. ProviderService — Add Caching

```javascript
// In ProviderService constructor
this.cache = new Map();  // in-memory fallback
this.cacheTtl = 300;     // 5 minutes

// getProjectProviders() — add caching
async getProjectProviders(projectId) {
  const cacheKey = `provider:${projectId || 'global'}`;
  const cached = this.cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < this.cacheTtl * 1000) {
    return cached.providers;
  }
  
  const providers = await this._fetchProviders(projectId);
  this.cache.set(cacheKey, { providers, timestamp: Date.now() });
  return providers;
}

// invalidateProviderCache()
static invalidateProviderCache(projectId = null) {
  if (projectId) {
    this.cache.delete(`provider:${projectId}`);
  } else {
    this.cache.clear();
  }
}
```

### 2. ProviderService — Add Changed Endpoint

```javascript
// GET /agents/:agentId/provider-config/changed
async getProviderConfigChange(agentId, apiKey, since) {
  const agent = await this.getAgentByApiKey(apiKey);
  if (!agent) throw new Error('AGENT_NOT_FOUND');
  
  // Check if provider config changed since timestamp
  const result = await pool.query(
    `SELECT updated_at FROM providers WHERE id = $1`, [agent.provider_id]
  );
  
  const changed = result.rows[0]?.updated_at > new Date(since);
  return { success: true, data: { changed, lastUpdated: result.rows[0]?.updated_at } };
}
```

### 3. Java Agent — Add Config Polling

```java
// In AgentApp constructor
this.configChangeChecker = new Thread(() -> {
    while (!shutdown) {
        try {
            Thread.sleep(60000);  // Check every 60 seconds
            checkProviderConfigChange();
        } catch (InterruptedException e) {
            break;
        }
    }
}, "provider-config-checker");
this.configChangeChecker.setDaemon(true);
this.configChangeChecker.start();

private void checkProviderConfigChange() {
    try {
        Map<String, Object> response = apiService.getProviderConfigChange(agentId, lastConfigCheck);
        Boolean changed = (Boolean) response.get("changed");
        if (Boolean.TRUE.equals(changed)) {
            log.info("Provider config changed, reloading...");
            this.aiProvider = createAiProvider();
            lastConfigCheck = System.currentTimeMillis();
        }
    } catch (Exception e) {
        log.warn("Failed to check provider config change", e);
    }
}
```

### 4. Call invalidation on provider mutations

In `backend/src/api/providers.js`:
- `POST /providers`: Call `ProviderService.invalidateProviderCache()` after insert
- `PUT /providers/:id`: Call invalidation after update
- `DELETE /providers/:id`: Call invalidation after delete

## Files to Change

| File | Changes |
|------|---------|
| `backend/src/services/ProviderService.js` | Add caching + invalidation + changed endpoint |
| `backend/src/api/agents.js` | Add GET /:agentId/provider-config/changed route |
| `backend/src/api/providers.js` | Call invalidation on mutations |
| `agent/src/main/java/com/vibecode/agent/AgentApp.java` | Add config polling thread |
| `agent/src/main/java/com/vibecode/agent/service/ApiService.java` | Add getProviderConfigChange() method |
| `agent/src/test/java/com/vibecode/agent/service/ProviderCacheTest.java` | New test file |

## Testing

- Backend: ProviderService cache invalidation tests (similar to PermissionService)
- Backend: Provider change detection tests
- Java: AgentApp config change detection tests (mocked)

## Out of Scope

- Redis integration for provider cache (in-memory only for this ticket)
- Webhook-based notification (polling is simpler and sufficient)
- Provider config change history/audit log
- Automatic agent restart on config change (just recreate AiProvider instance)

## Deferred Improvements Found

| # | From Ticket | Improvement | Category | Suggested Next Ticket |
|---|-------------|-------------|----------|----------------------|
| 1 | bp-112 | Java agent unit tests | Testing | bp-118-java-agent-unit-tests |
| 2 | bp-113 | Route-level permission guards | Security | bp-115-route-permission-guards |
| 3 | bp-113 | Planning file usage UI | UX | bp-116-planning-file-usage-ui |
| 4 | bp-113 | Route mount audit script | Developer experience | bp-117-route-mount-audit |
