# 02_ARCHITECT_DESIGN.md — fg-29 Provider Config API Key Field

## Approach

Add an API key input field to the Provider Config form, fix field name mismatches, and wire up storage.

## Design Decisions

### Decision 1: Store API Key Directly (Not as Credential Reference)

**Option A**: Use existing `api_key_credential_id` as a reference to `credentials` table
- Pros: Follows existing pattern, supports key rotation
- Cons: Requires creating a credential record first, adds complexity

**Option B**: Store encrypted API key directly in a new `api_key_encrypted` column
- Pros: Simple, self-contained, no extra table lookups
- Cons: Duplicates encryption logic (already in `crypto.js`)

**Decision**: **Option B** — Add a new `api_key_encrypted TEXT` column to `provider_configs`. Rationale:
- Provider configs are per-project, single-provider defaults
- Credential management is handled separately by the `project_providers` table
- Simpler UX: user enters API key once, it's stored directly
- No credential creation step required

### Decision 2: Field Naming Convention

**Option A**: Frontend sends camelCase, backend converts
- Pros: Matches JavaScript conventions
- Cons: Requires transformation layer

**Option B**: Standardize on snake_case end-to-end
- Pros: Matches database column names, no transformation needed
- Cons: Frontend typically uses camelCase

**Decision**: **Option B** — Standardize on snake_case end-to-end. Rationale:
- Database columns are snake_case (`endpoint_url`, `api_key_encrypted`, `fallback_provider`)
- No transformation layer needed
- Frontend already sends `endpoint_url` (snake_case) in some places
- Simpler code, fewer bugs

### Decision 3: API Key Visibility

**Option A**: Always show API key field
- Pros: Simple, consistent UI, users can add keys to local models if needed
- Cons: Slightly more fields on the form

**Option B**: Show conditionally based on provider type
- Pros: Hides irrelevant fields for local models
- Cons: Confusing if a local model actually needs an auth token

**Decision**: **Option A** — Always show API key field for all provider types, marked as optional. Rationale:
- Local models may still need API keys (Ollama with auth, vLLM with tokens, etc.)
- Consistent UI regardless of provider type
- Users can leave it blank if not needed
- Clear visual distinction via placeholder text (e.g., "optional for local models")

## Component Changes

### Frontend: `ProjectDetail.vue`

Add API key input field after the Model field (line ~508), visible for all providers:

```vue
<div class="form-group">
  <label>API Key <span class="optional">(optional)</span></label>
  <input v-model="providerConfig.api_key" type="password" placeholder="sk-... (optional for local models)" />
</div>
```

Update `loadProviderConfig()` to map `api_key_encrypted` → `api_key` (masked, first 4 + last 4 visible):
```js
providerConfig.value = {
  provider: config.provider,
  model: config.model,
  endpoint_url: config.endpoint_url,
  api_key: config.api_key ? maskToken(config.api_key) : '',
  fallback_provider: config.fallback_provider,
}
```

Where `maskToken` shows first 4 and last 4 characters:
```js
function maskToken(key) {
  if (!key || key.length < 8) return '••••••••'
  return key.substring(0, 4) + '••••' + key.substring(key.length - 4)
}
```

Update `saveProviderConfig()` to send snake_case fields:
```js
const payload = {
  provider: providerConfig.value.provider,
  model: providerConfig.value.model,
  endpoint_url: providerConfig.value.endpoint_url,
  api_key: providerConfig.value.api_key,
  fallback_provider: providerConfig.value.fallback_provider,
}
```

### Backend: `providerController.js`

Update `setProviderConfig` to:
1. Accept snake_case fields from validator
2. Encrypt `api_key` before storage
3. Return masked API key on GET (first 4 + last 4 visible)

```js
async function setProviderConfig(req, res, next) {
  const { provider, model, endpoint_url, api_key, fallback_provider } = req.body;
  const encryptedKey = api_key ? encrypt(api_key) : null;
  // ... INSERT/UPDATE with api_key_encrypted = encryptedKey
}

async function getProviderConfig(req, res, next) {
  // Return api_key_encrypted as api_key (masked: first 4 + last 4 visible)
  const maskedKey = row.api_key_encrypted 
    ? maskToken(row.api_key_encrypted)  // first 4 + last 4 visible
    : null;
  // ... return { api_key: maskedKey, ... }
}
```

Where `maskToken` is reused from `crypto.js` (already exists):
```js
function maskToken(key) {
  if (!key || key.length < 8) return '••••••••'
  return key.substring(0, 4) + '••••' + key.substring(key.length - 4)
}
```

### Backend: `providerConfig.js` (validator)

Update schema to accept `api_key` (raw string) instead of `api_key_credential_id` (UUID):

```js
const setProviderConfigSchema = Joi.object({
  provider: Joi.string().min(1).required(),
  endpoint_url: Joi.string().uri().allow('').optional(),
  model: Joi.string().min(1).required(),
  api_key: Joi.string().allow('').optional(),  // NEW: raw API key
  fallback_provider: Joi.string().allow('').optional(),
});
```

### Database Migration

Add `api_key_encrypted TEXT` column to `provider_configs`:

```sql
ALTER TABLE provider_configs ADD COLUMN api_key_encrypted TEXT;
```

Rollback:
```sql
ALTER TABLE provider_configs DROP COLUMN IF EXISTS api_key_encrypted;
```

## Data Flow

```
Frontend (ProjectDetail.vue)
  ↓ POST /providers/projects/:id/provider
  { provider, model, endpoint_url, api_key, fallback_provider }
  ↓
Backend (providerController.setProviderConfig)
  ↓ encrypt(api_key)
  ↓ INSERT/UPDATE provider_configs SET api_key_encrypted = ?
  ↓
Database (provider_configs.api_key_encrypted)
```

## Error Handling

- Empty `api_key` → treat as "no change" (don't overwrite existing key)
- Invalid API key → "Test Connection" will fail, user gets error message
- Encryption failure → return 500 with error message

## Security Considerations

- API key is encrypted before storage using existing `crypto.js` encrypt/decrypt
- API key is never logged (winston logger masks sensitive fields)
- API key is masked in GET responses (first 4 + last 4 chars visible, middle obscured)
- API key is never included in error messages or stack traces
- `maskToken` utility already exists in `crypto.js` — reuse it for consistency
