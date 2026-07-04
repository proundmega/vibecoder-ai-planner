# 03_ARCHITECT_IMPLEMENTATION.md — OpenAI-Compatible Endpoint Support

**Status**: planned
**Priority**: P1
**Effort**: Large
**Author**: AI Assistant
**Date created**: 2026-06-10
**Date completed**: TBD
**PR**: TBD
**Branch**: rs-14-openai-endpoints

**Dependencies**: rs-15-api-keys (encryption infrastructure)

---

### a) Purpose

Replace Anthropic-only AI provider support with a pluggable provider system. Projects can configure multiple providers (Claude, OpenAI, LM Studio, etc.) and assign each to a role (planner/worker/reviewer/approver). This enables cost optimization (cheap local models for testing, premium models for planning) and vendor flexibility.

**Value delivered**: Users can use their own API keys with any provider, mix and match for cost/performance, and extend with new providers by adding a folder.

---

### b) Actions

1. **Create encryption utility** — `backend/src/utils/crypto.js`
   - `encrypt(text)` → AES-256-GCM with IV + auth tag
   - `decrypt(encryptedText)` → reverse of encrypt
   - Shared across all provider types and GitHub PATs

2. **Create provider base interface** — `backend/src/providers/base/ProviderInterface.js`
   - Abstract methods: `chat(messages, options)`, `validate()`, `formatSystemPrompt(systemPrompt)`
   - All providers must extend this class

3. **Create provider implementations**
   ```
   backend/src/providers/claude/
     index.js    → ClaudeProvider (extends ProviderInterface)
     api.js      → Anthropic SDK wrapper
     prompts.js  → Claude-specific prompt formatting
   
   backend/src/providers/openai/
     index.js    → OpenAIProvider (extends ProviderInterface)
     api.js      → OpenAI SDK wrapper
     prompts.js  → OpenAI-specific prompt formatting
   
   backend/src/providers/generic/
     index.js    → GenericProvider (extends ProviderInterface)
     api.js      → Axios-based HTTP client for any OpenAI-compatible endpoint
     prompts.js  → Standard OpenAI message format
   ```

4. **Create ProviderRouter** — `backend/src/services/ProviderRouter.js`
   - `loadProviders()` → fetches active providers from DB
   - `getForRole(role)` → returns provider for given role ('planner', 'worker', etc.)
   - `createProvider(row)` → factory method based on provider_type

5. **Create migration** — `backend/src/migrations/009_project_providers.sql`
   - `project_providers` table with roles array, provider_type, encryption

6. **Create controllers** — `backend/src/controllers/providerController.js`
   - `addProvider(req, res, next)` → POST `/api/projects/:id/providers`
   - `updateProvider(req, res, next)` → PATCH `/api/projects/:id/providers/:providerId`
   - `deleteProvider(req, res, next)` → DELETE `/api/projects/:id/providers/:providerId`
   - `listProviders(req, res, next)` → GET `/api/projects/:id/providers`
   - `testProvider(req, res, next)` → POST `/api/projects/:id/providers/:providerId/test`

7. **Create routes** — `backend/src/api/providers.js`
   - `POST /api/projects/:id/providers` — add provider
   - `GET /api/projects/:id/providers` — list providers
   - `PATCH /api/projects/:id/providers/:id` — update provider
   - `DELETE /api/projects/:id/providers/:id` — remove provider
   - `POST /api/projects/:id/providers/:id/test` — test connection

8. **Create tests**
   - `backend/src/__tests__/providerRouter.test.js` — router unit tests
   - `backend/src/__tests__/claudeProvider.test.js` — Claude provider tests
   - `backend/src/__tests__/openaiProvider.test.js` — OpenAI provider tests
   - `backend/src/__tests__/genericProvider.test.js` — Generic provider tests
   - `backend/src/__tests__/providerController.test.js` — Controller tests

---

### c) Dependencies

- **@anthropic-ai/sdk** — Anthropic API client
- **openai** — OpenAI API client
- **axios** — Generic HTTP client for custom endpoints
- **crypto** — Node.js built-in for encryption
- **process.env.PROVIDER_ENCRYPTION_KEY** — 32-byte hex master key
- **rs-15-api-keys** — shared encryption infrastructure

---

### d) Risks/Edge Cases

- **[Provider downtime]**: One provider down doesn't block the project — fallback to another
- **[Rate limits]**: Each provider has different rate limits — track per-provider in usage table
- **[Key rotation]**: Update provider config without downtime
- **[Model versioning]**: Models change names — allow easy model updates via UI
- **[Custom endpoints]**: Generic provider must handle auth headers correctly (some use `api-key` header instead of `Authorization`)
- **[Response format]**: Different providers may return different usage/stop_reason formats — normalize in interface

---

### e) Testing

#### Unit Tests
- [ ] ProviderRouter.loadProviders() — loads and caches providers
- [ ] ProviderRouter.getForRole('planner') — returns correct provider
- [ ] ProviderRouter.getForRole('unknown') — throws error
- [ ] ClaudeProvider.chat() — calls Anthropic API correctly
- [ ] OpenAIProvider.chat() — calls OpenAI API correctly
- [ ] GenericProvider.chat() — calls custom endpoint correctly
- [ ] Encryption/decryption roundtrip
- [ ] Provider validation (valid vs invalid key)

#### Integration Tests
- [ ] Full request lifecycle: add provider → test connection → use in agent
- [ ] Error handling: invalid key, network failure, rate limit
- [ ] Role assignment: provider with multiple roles works for all

#### Frontend Tests
- [ ] Component: Provider configuration form
- [ ] Component: Provider list with role badges
- [ ] Component: Test connection button

---

### f) Migration Notes

```sql
-- Migration: 009_project_providers.sql
CREATE TABLE IF NOT EXISTS project_providers (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  provider_type VARCHAR(50) NOT NULL DEFAULT 'claude',
  api_key_encrypted TEXT NOT NULL,
  base_url TEXT,
  model VARCHAR(100) NOT NULL,
  roles TEXT[] NOT NULL DEFAULT ARRAY['worker'],
  max_tokens INTEGER DEFAULT 4096,
  temperature DECIMAL(3,2) DEFAULT 0.1,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT valid_provider_type CHECK (provider_type IN ('claude', 'openai', 'generic')),
  CONSTRAINT valid_roles CHECK (array_length(roles, 1) > 0)
);
CREATE INDEX idx_project_providers_project_id ON project_providers(project_id);
CREATE INDEX idx_project_providers_is_active ON project_providers(is_active);
CREATE INDEX idx_project_providers_roles ON project_providers USING GIN(roles);
```

---

### g) Notes

- Provider interface pattern makes adding new providers trivial (just add a folder)
- Roles array allows one provider to serve multiple agent roles
- Generic provider uses standard OpenAI `/chat/completions` endpoint format
- All provider responses normalized to `{ content, usage, stop_reason }`
- Encryption key from env, not DB — separate from provider keys

---

*This ticket follows the 3 ARCHITECT templates:*
- *`01_ARCHITECT_REQUIREMENT.md` → Requirements, testing checklist, CI requirements*
- *`02_ARCHITECT_DESIGN.md` → Design spec, provider interface, folder structure, router*
- *`03_ARCHITECT_IMPLEMENTATION.md` → Purpose, actions, dependencies, risks, testing*
