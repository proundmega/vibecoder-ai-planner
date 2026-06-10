# 02_ARCHITECT_DESIGN.md — Secure API Key Storage

**Status**: planned
**Date created**: 2026-06-10
**Author**: AI Assistant

---

## Problem Statement

API keys (Anthropic, OpenAI, GitHub PATs) need to be stored securely. Currently they're passed as plain text. We need encryption at rest, role-based access, and key masking in API responses.

---

## Current State

- No key storage — keys passed per-request or in env vars
- No encryption
- No role-based access to key management

---

## Design

### Architecture

```
Project Admin → UI (masked keys) → API (encrypted storage) → DB (encrypted)
                                                    ↓
                                            Agent Service (decrypted at runtime)
```

### Database Schema

```sql
CREATE TABLE IF NOT EXISTS project_credentials (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,              -- e.g., 'Anthropic API Key', 'GitHub PAT'
  credential_type VARCHAR(50) NOT NULL,     -- 'anthropic', 'openai', 'github', 'custom'
  key_encrypted TEXT NOT NULL,
  key_masked VARCHAR(20) NOT NULL,          -- last 4 chars for display: '••••1234'
  metadata JSONB DEFAULT '{}',              -- provider-specific config (base_url, model, etc.)
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

### Encryption

AES-256-GCM with IV and auth tag:
```javascript
// backend/src/utils/crypto.js
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const MASTER_KEY = process.env.CREDENTIAL_ENCRYPTION_KEY; // 32 bytes hex

if (!MASTER_KEY || MASTER_KEY.length !== 64) {
  throw new Error('CREDENTIAL_ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
}

function encrypt(plaintext) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(MASTER_KEY, 'hex'), iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(encryptedText) {
  const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(MASTER_KEY, 'hex'), iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = { encrypt, decrypt };
```

### Key Masking

```javascript
function maskKey(key) {
  if (!key || key.length < 4) return '••••';
  return '•'.repeat(key.length - 4) + key.slice(-4);
}

// Examples:
// 'sk-ant-api03-...' → '••••••••••••1234'
// 'ghp_xxxxxxxxxxxx' → '••••••••••abcd'
```

### Access Control

| Role | Can View Keys | Can Edit Keys | Can Use Keys |
|------|--------------|---------------|--------------|
| `project_admin` | Yes (masked) | Yes | Yes |
| `member` | No | No | Yes (via agents) |
| `user` | No | No | No |
| `super_admin` | Yes (masked) | No | No |

**Route protection:**
```javascript
router.post('/', verifyToken, requireAnyPermission('PROJECT_MANAGE_MEMBERS'), credentialController.addCredential);
router.get('/', verifyToken, requireAnyPermission('PROJECT_MANAGE_MEMBERS'), credentialController.listCredentials);
router.patch('/:id', verifyToken, requireAnyPermission('PROJECT_MANAGE_MEMBERS'), credentialController.updateCredential);
router.delete('/:id', verifyToken, requireAnyPermission('PROJECT_MANAGE_MEMBERS'), credentialController.deleteCredential);
```

### API Response Format

```json
// GET /api/projects/:id/credentials
{
  "success": true,
  "data": {
    "credentials": [
      {
        "id": 1,
        "name": "Anthropic API Key",
        "credential_type": "anthropic",
        "key_masked": "••••••••••••sF3k",
        "expires_at": null,
        "is_active": true,
        "created_at": "2026-06-10T10:00:00Z"
      }
    ]
  }
}
```

**Never return the full decrypted key in API responses.**

### Key Usage Flow

```javascript
// backend/src/services/CredentialService.js
async function getCredentialForProject(projectId, credentialType) {
  const result = await pool.query(
    `SELECT key_encrypted FROM project_credentials 
     WHERE project_id = $1 AND credential_type = $2 AND is_active = true 
     ORDER BY created_at DESC LIMIT 1`,
    [projectId, credentialType]
  );
  
  if (result.rows.length === 0) {
    throw new Error(`No ${credentialType} credential configured for this project`);
  }
  
  // Decrypt at runtime, never cache decrypted keys
  return decrypt(result.rows[0].key_encrypted);
}
```

### Key Rotation

```javascript
// When rotating a key:
// 1. Create new credential entry with new key
// 2. Set old entry is_active = false
// 3. Agents automatically use the newest active key
```

---

## Dependencies

- **crypto** — Node.js built-in for AES-256-GCM
- **process.env.CREDENTIAL_ENCRYPTION_KEY** — 32-byte hex master key

---

## Risks/Edge Cases

- **[Key loss]**: If `CREDENTIAL_ENCRYPTION_KEY` is lost, all stored keys are unrecoverable — document recovery procedure
- **[Key rotation]**: Old agents using old keys — ensure key versioning or atomic swap
- **[Brute force]**: Encryption key from env, not brute-forced — no additional protection needed
- **[Audit trail]**: Track who added/rotated keys — add `created_by` and `updated_by` columns
- **[Expiry]**: Keys can expire (GitHub PATs) — `expires_at` column for proactive expiration warnings

---

## Migration Notes

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

*This document defines the design for secure API key storage. See `01_ARCHITECT_REQUIREMENT.md` for requirements and `03_ARCHITECT_IMPLEMENTATION.md` for implementation details.*
