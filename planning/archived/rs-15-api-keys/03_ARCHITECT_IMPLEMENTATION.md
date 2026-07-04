# 03_ARCHITECT_IMPLEMENTATION.md — Secure API Key Storage

**Status**: planned
**Priority**: P0 (foundation for all provider features)
**Effort**: Medium
**Author**: AI Assistant
**Date created**: 2026-06-10
**Date completed**: TBD
**PR**: TBD
**Branch**: rs-15-api-keys

**Dependencies**: None (foundation ticket — other tickets depend on this)

---

### a) Purpose

Securely store and manage API keys for AI providers and GitHub integration. Keys encrypted at rest with AES-256-GCM, masked in API responses, accessible only to project_admin. This is the foundation for all provider features (rs-14) and repo integration (rs-13).

**Value delivered**: Keys never stored in plaintext, project admins have full control over key lifecycle, agents securely access keys at runtime.

---

### b) Actions

1. **Create encryption utility** — `backend/src/utils/crypto.js`
   - `encrypt(plaintext)` → AES-256-GCM with IV + auth tag
   - `decrypt(encryptedText)` → reverse of encrypt
   - Validates `CREDENTIAL_ENCRYPTION_KEY` env var on load

2. **Create migration** — `backend/src/migrations/010_project_credentials.sql`
   - `project_credentials` table with encrypted key storage
   - `key_masked` column for UI display
   - `metadata` JSONB for provider-specific config

3. **Create CredentialService** — `backend/src/services/CredentialService.js`
   - `addCredential(projectId, name, type, key, metadata, userId)` → encrypts and stores
   - `listCredentials(projectId)` → returns masked keys
   - `updateCredential(id, updates)` → re-encrypts if key changed
   - `deleteCredential(id)` → soft delete (is_active = false)
   - `getDecryptedKey(projectId, type)` → returns decrypted key for agent use
   - `maskKey(key)` → helper for masking

4. **Create credentialController** — `backend/src/controllers/credentialController.js`
   - `addCredential(req, res, next)` → POST `/api/projects/:id/credentials`
   - `listCredentials(req, res, next)` → GET `/api/projects/:id/credentials`
   - `updateCredential(req, res, next)` → PATCH `/api/projects/:id/credentials/:id`
   - `deleteCredential(req, res, next)` → DELETE `/api/projects/:id/credentials/:id`
   - `rotateCredential(req, res, next)` → POST `/api/projects/:id/credentials/:id/rotate`

5. **Create routes** — `backend/src/api/credentials.js`
   - `POST /api/projects/:id/credentials` — add credential
   - `GET /api/projects/:id/credentials` — list credentials (masked)
   - `PATCH /api/projects/:id/credentials/:id` — update credential
   - `DELETE /api/projects/:id/credentials/:id` — delete credential
   - `POST /api/projects/:id/credentials/:id/rotate` — rotate key

6. **Create tests**
   - `backend/src/__tests__/crypto.test.js` — encryption/decryption tests
   - `backend/src/__tests__/credentialService.test.js` — service unit tests
   - `backend/src/__tests__/credentialController.test.js` — controller tests

7. **Update ProviderRouter** — consume decrypted keys from CredentialService

---

### c) Dependencies

- **crypto** — Node.js built-in for AES-256-GCM
- **process.env.CREDENTIAL_ENCRYPTION_KEY** — 32-byte hex master key

---

### d) Risks/Edge Cases

- **[Key loss]**: If `CREDENTIAL_ENCRYPTION_KEY` env var is lost, all stored keys are unrecoverable — document recovery procedure
- **[Key rotation]**: Atomic swap needed — create new entry, deactivate old, no downtime
- **[Audit trail]**: Track who added/rotated keys — `created_by` and `updated_by` columns
- **[Expiry]**: GitHub PATs expire — `expires_at` column for proactive warnings
- **[Brute force]**: Encryption key from env, not brute-forced — no additional protection needed

---

### e) Testing

#### Unit Tests
- [ ] crypto.encrypt() / crypto.decrypt() — roundtrip
- [ ] crypto.decrypt() with wrong key — throws error
- [ ] CredentialService.addCredential() — encrypts and stores
- [ ] CredentialService.listCredentials() — returns masked keys
- [ ] CredentialService.getDecryptedKey() — returns decrypted key
- [ ] CredentialService.rotateCredential() — creates new, deactivates old
- [ ] maskKey() — correct masking for various key lengths

#### Integration Tests
- [ ] Full request lifecycle: add credential → list (masked) → decrypt → use
- [ ] Error handling: missing encryption key, invalid credential type
- [ ] Authorization: non-admin cannot access credentials endpoint

---

### f) Migration Notes

```sql
-- Migration: 010_project_credentials.sql
CREATE TABLE IF NOT EXISTS project_credentials (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  credential_type VARCHAR(50) NOT NULL DEFAULT 'anthropic',
  key_encrypted TEXT NOT NULL,
  key_masked VARCHAR(20) NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_by BIGINT REFERENCES users(id),
  expires_at TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT valid_credential_type CHECK (credential_type IN ('anthropic', 'openai', 'github', 'custom'))
);
CREATE INDEX idx_project_credentials_project_id ON project_credentials(project_id);
CREATE INDEX idx_project_credentials_is_active ON project_credentials(is_active);
CREATE INDEX idx_project_credentials_type ON project_credentials(credential_type);
```

---

### g) Notes

- Encryption key from env var, not DB — separate from stored keys
- Keys never cached in memory — decrypt on each agent call
- Key rotation creates new entry, deactivates old — no downtime
- Masked keys shown in UI: `••••1234` (last 4 chars visible)
- All provider features (rs-14, rs-13) consume keys from this service

---

*This ticket follows the 3 ARCHITECT templates:*
- *`01_ARCHITECT_REQUIREMENT.md` → Requirements, testing checklist, CI requirements*
- *`02_ARCHITECT_DESIGN.md` → Design spec, encryption, masking, access control*
- *`03_ARCHITECT_IMPLEMENTATION.md` → Purpose, actions, dependencies, risks, testing*
