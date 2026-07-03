# 02_ARCHITECT_DESIGN.md — Security Hardening

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Both

---

## Problem Statement

Multiple security vulnerabilities across the codebase: hardcoded secrets in 3+ files, encryption key unchecked, JWT tokens passed in URL query strings, infrastructure ports exposed to host, and missing security headers in reverse proxy configs.

---

## Current State

### JWT Secret — Triplicated Fallback

```javascript
// middleware/auth.js:6
const JWT_SECRET = process.env.JWT_SECRET || 'vibecode-dev-secret-do-not-use-in-production';
// auth.js:5
const TOKEN_SECRET = process.env.JWT_SECRET || 'vibecode-dev-secret-do-not-use-in-production';
// services/UserService.js:41
const JWT_SECRET = process.env.JWT_SECRET || 'vibecode-dev-secret-do-not-use-in-production';
```

### Encryption Key — No Length Validation

```javascript
// utils/crypto.js:16
const MASTER_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
```

### JWT in WebSocket URL

```javascript
// frontend/src/views/TerminalView.vue:32
const ws = new WebSocket(`ws://${host}/api/terminal/${agentId}?token=${getToken()}`);
```

### Infrastructure Exposure

```yaml
# docker-compose.yml
postgres:
  ports: ["5432:5432"]     # exposed to host
pgadmin:
  ports: ["5050:80"]       # exposed to host
api:
  environment:
    ENCRYPTION_KEY: 0123456789abcdef...  # hardcoded default
```

---

## Design

### Option A: Layer-by-Layer Fix (Recommended)

#### Layer 1: Backend Secrets Consolidation

Create `utils/jwt.js`:
```javascript
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is required');
  process.exit(1);
}
module.exports = { JWT_SECRET };
```

Update `envValidation.js`:
```javascript
if (process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length !== 64) {
  logger.error('FATAL: ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)');
  process.exit(1);
}
```

#### Layer 2: WebSocket Auth

Move token from query string to first WebSocket message frame. Backend handler waits for first message containing `{ type: 'auth', token: '...' }` before allowing any other communication.

#### Layer 3: Infrastructure

Use Docker Compose profiles for development services:
```yaml
pgadmin:
  profiles: [dev]  # only starts with dev profile
postgres:
  ports: ["5432:5432"]  # move to override.yml
```

### Option B: Wrap and Redirect

Not applicable — these are direct fixes, not architectural changes.

---

## File-Level Impact Matrix

| File | Action |
|------|--------|
| `backend/src/utils/jwt.js` | CREATE |
| `backend/src/middleware/auth.js` | MODIFY |
| `backend/src/auth.js` | MODIFY |
| `backend/src/services/UserService.js` | MODIFY |
| `backend/src/utils/envValidation.js` | MODIFY |
| `backend/src/utils/crypto.js` | MODIFY |
| `backend/src/services/DeployService.js` | MODIFY |
| `backend/src/index.js` | MODIFY |
| `backend/src/api/terminal.js` | MODIFY |
| `frontend/src/views/TerminalView.vue` | MODIFY |
| `frontend/nginx.conf` | MODIFY |
| `docker-compose.yml` | MODIFY |
| `docker-compose.override.yml` | MODIFY |
| `.env` | MODIFY |

---

## Dependencies

- No new npm dependencies
- WebSocket backend handler needs to support message-based auth

---

## Risks and Edge Cases

- **[WebSocket auth regression]**: Changing the auth mechanism will break existing terminal connections until both frontend and backend are deployed together.
- **[Startup crash for missing JWT]**: Existing deployments without `JWT_SECRET` set will crash on upgrade. Must document this as a breaking change in the migration notes.
