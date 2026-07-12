# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: planned
**Date created**: 2026-07-12
**Date completed**: {{YYYY-MM-DD}}
**Author**: AI Assistant
**Scope**: Backend | Java Agent
**Priority**: P1
**Effort**: Medium

---

## Requirement

Currently, Java agents read AI provider configuration (API key, endpoint, model) entirely from environment variables at startup. This is brittle — API keys are hardcoded in env vars, and changing providers requires rebuilding/redeploying the container.

After bp-01, agents have a `provider_id` linking them to a global `providers` record. The agent should **fetch its provider config from the backend at startup** using this link, instead of relying on env vars.

This makes provider configuration:
- **Secure**: API keys stay encrypted in the DB, never in env vars or container images
- **Dynamic**: Change a provider's model or endpoint, and agents pick it up on next restart
- **Centralized**: All provider management in one place (the `/providers` UI)

---

## Existing Infrastructure Audit

### Backend API Check
- [x] Agent routes exist: `backend/src/api/agents.js`
- [x] AgentService exists: `backend/src/services/AgentService.js` — has `getAgentByApiKey()`
- [x] Providers table exists: global (from bp-01), has `api_key_encrypted` column
- [x] ProviderService exists: `backend/src/services/ProviderService.js` — has decrypt logic
- [x] Encryption utilities exist: `backend/src/utils/encryption.js` — `decrypt()` function
- [ ] **New endpoint needed**: `GET /api/v1/agents/:agentId/provider-config` — returns decrypted provider config

### Java Agent Check
- [x] AgentConfig.java: reads AI_PROVIDER, AI_MODEL, AI_API_KEY, AI_ENDPOINT_URL from env vars
- [x] AgentApp.java: `createAiProvider()` builds provider from env vars
- [x] ApiService.java: has `getDecryptedKey()` method — **exists but never called** (dead code)
- [x] TicketProcessor.java: uses `aiProvider` instance — no changes needed
- [x] docker-compose.yml: passes AI_* env vars — can be simplified after this change
- [ ] **New API endpoint needed in agent**: `POST /api/agents/:agentId/usage` — report token usage (deferred to bp-04)

### Key Insight

This is a **backend API + Java agent** task. The backend needs a new endpoint to serve decrypted provider config. The Java agent needs to call this endpoint at startup and use the result to initialize its AI provider.

The existing `ApiService.getDecryptedKey()` is dead code — we'll repurpose or replace it with a proper provider config fetch.

---

## Scope

### In Scope
- [ ] Backend: New endpoint `GET /api/v1/agents/:agentId/provider-config`
- [ ] Backend: Returns decrypted provider config (api_key, base_url, model, provider_type, max_tokens)
- [ ] Backend: Endpoint authenticated by X-API-Key (agent's own API key)
- [ ] Backend: Returns 404 if agent not found or has no provider_id
- [ ] Java agent: Fetch provider config from backend at startup
- [ ] Java agent: Use fetched config to initialize AI provider (replace env var logic)
- [ ] Java agent: Fallback to env vars if backend fetch fails (backward compatibility)
- [ ] Java agent: docker-compose.yml — remove AI_* env vars (they're optional now)
- [ ] Tests: Backend unit test for new endpoint

### Out of Scope
- [ ] Java agent unit tests (no existing Java test infrastructure — manual testing only)
- [ ] Runtime provider config reload (agent restart required for config changes)
- [ ] Provider health checking before use
- [ ] Multi-provider fallback at agent level
- [ ] Usage reporting (deferred to bp-04)

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/api/agents.js` | MODIFY | Add `GET /:agentId/provider-config` route |
| `backend/src/controllers/agentController.js` | MODIFY (or CREATE) | New `getProviderConfig` method |
| `backend/src/services/AgentService.js` | MODIFY | New `getProviderConfig(agentId)` method |
| `agent/src/main/java/com/vibecode/agent/config/AgentConfig.java` | MODIFY | Make AI_* env vars optional |
| `agent/src/main/java/com/vibecode/agent/AgentApp.java` | MODIFY | Fetch provider config from backend at startup |
| `agent/src/main/java/com/vibecode/agent/service/ApiService.java` | MODIFY | Add `getProviderConfig(agentId)` method |
| `agent/docker-compose.yml` | MODIFY | Remove AI_* env vars (optional, keep as fallback) |

---

## Known Unknowns

1. **Java agent API key**: The agent authenticates to the backend with `X-API-Key: AGENT_API_KEY`. The `getAgentByApiKey()` method returns the agent record including `provider_id`. From there, we join to `providers` to get the config.

2. **Encrypted API key decryption**: The `providers.api_key_encrypted` column stores encrypted keys. We need to decrypt it on the backend before sending to the agent. The agent receives the plaintext key in the response.

3. **Agent startup timing**: The provider config fetch happens during agent construction, before the main loop. If it fails, the agent should either crash (fail-fast, safer) or fall back to env vars (more resilient).

---

## Important Design Decisions

**DECISION — Fallback behavior if backend fetch fails:**

Option A: Crash on failure. The agent cannot function without a provider. Failing fast is safer — you notice immediately that configuration is broken.
Option B: Fall back to env vars. More resilient, but risks the agent using stale/wrong config without the operator knowing.

**Recommendation**: Option A (crash) as primary, with env vars as a **last resort** fallback. The agent logs a warning if falling back, so the operator knows.

---

## Acceptance Criteria

1. [ ] [Backend] `GET /api/v1/agents/:agentId/provider-config` returns decrypted provider config
2. [ ] [Backend] Endpoint authenticates via X-API-Key header
3. [ ] [Backend] Returns 404 if agent not found or has no provider_id
4. [ ] [Backend] Returns 404 if provider not found
5. [ ] [Backend] Response shape: `{ success: true, data: { provider_type, api_key, base_url, model, max_tokens, ... } }`
6. [ ] [Java Agent] Agent fetches provider config from backend at startup
7. [ ] [Java Agent] Agent uses fetched config to initialize AI provider
8. [ ] [Java Agent] Agent falls back to env vars if backend fetch fails (with warning log)
9. [ ] [Java Agent] docker-compose.yml works with minimal env vars (AGENT_API_KEY + BACKEND_URL only)
10. [ ] [Tests] Backend unit test for new endpoint

---

## Out of Scope

- Java agent unit tests (no existing test infrastructure)
- Runtime config reload
- Provider health checking
- Usage reporting (bp-04)

---

## Security Considerations

- [x] Endpoint requires valid X-API-Key (agent's own key)
- [x] Agent can only fetch its own provider config (not arbitrary agents)
- [x] API keys are decrypted server-side, never stored plaintext
- [x] Response includes only necessary fields (api_key, base_url, model, provider_type, max_tokens)
- [x] No PII or sensitive data in response

---

## Testing Checklist

### Backend Tests
- [ ] Unit test: `GET /api/v1/agents/:agentId/provider-config` returns correct config
- [ ] Unit test: Returns 401 without X-API-Key
- [ ] Unit test: Returns 404 for unknown agent
- [ ] Unit test: Returns 404 for agent without provider_id
- [ ] Unit test: Returns 404 if provider referenced by agent doesn't exist

### Java Agent Testing
- [ ] Agent starts with provider config from backend (manual test)
- [ ] Agent falls back to env vars when backend is unreachable (manual test)
- [ ] Agent uses correct provider type (claude/openai/generic) based on config
- [ ] docker-compose agent service starts with minimal env vars

---

## Anti-Patterns to Avoid

- ❌ **Returning encrypted API key to agent** — decrypt server-side
- ❌ **Returning full provider record** — only send fields the agent needs
- ❌ **Hardcoding provider field names** — use the same names as the providers table
- ❌ **Ignoring the existing dead code** — `ApiService.getDecryptedKey()` exists but is unused; repurpose or replace cleanly
- ❌ **Creating new encryption utilities** — reuse existing `decrypt()` from `utils/encryption.js`
- ❌ **Skipping fallback** — env vars should still work for backward compatibility

---

*Fill in all sections before starting implementation.*
