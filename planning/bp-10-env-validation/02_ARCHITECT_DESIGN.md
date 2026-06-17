# 02_ARCHITECT_DESIGN.md — Environment Variable Validation

**Status**: planned
**Date created**: 2026-06-17
**Author**: AI Assistant

---

## Problem Statement

No environment variable validation. Missing `DATABASE_URL` causes cryptic "Cannot connect to undefined" errors. Missing `JWT_SECRET` causes silent authentication failures.

---

## Current State

```javascript
// backend/src/index.js
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// No validation — crashes later with "Cannot connect to undefined"
```

---

## Design

### Env Var Validator

```javascript
// backend/src/utils/env.js
const requiredEnvVars = [
  'DATABASE_URL',
  'JWT_SECRET',
  'NODE_ENV',
];

function validateEnv() {
  const missing = requiredEnvVars.filter(v => !process.env[v]);
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    console.error('See .env.example for required variables.');
    process.exit(1);
  }
  
  // Validate DATABASE_URL format
  if (!process.env.DATABASE_URL.match(/^postgresql:/)) {
    console.error('DATABASE_URL must be a valid PostgreSQL connection string (postgresql://...)');
    process.exit(1);
  }
  
  // Validate JWT_SECRET length
  if (process.env.JWT_SECRET.length < 32) {
    console.error('JWT_SECRET must be at least 32 characters long');
    process.exit(1);
  }
}

module.exports = { validateEnv };
```

### Call on Startup

```javascript
// backend/src/index.js
const { validateEnv } = require('./utils/env');
validateEnv();

// Rest of app setup...
```

### .env.example

```env
# Required
DATABASE_URL=postgresql://user:pass@localhost:5432/vibecode
JWT_SECRET=your-secret-key-at-least-32-characters-long
NODE_ENV=development

# Optional
DATABASE_POOL_MAX=20
REQUEST_TIMEOUT_MS=30000
LOG_LEVEL=info
```

### Alternative Designs Considered

- **Joi for env validation** — Chose manual validation over Joi because: it is simpler, has zero dependencies, and the validation rules are straightforward (presence check, format regex, length check). Joi was considered but rejected because: it adds a dependency for what is essentially a startup-time check, and the schema definition overhead is not justified for 3-5 env vars.
- **dotenv-safe over manual check** — Chose manual validation over `dotenv-safe` because: it avoids an additional npm dependency and gives full control over error messages. `dotenv-safe` was considered but rejected because: it is a small library and the manual approach is equally effective for the number of required vars.
- **Validate only in development** — Chose validate-everywhere over dev-only validation because: production misconfigurations are more dangerous than development ones, and catching them at startup prevents ambiguous runtime errors. Dev-only validation was considered but rejected because: a missing env var in production causes a harder-to-debug crash, and the startup cost of validation is negligible.

### Data Flow Diagram

```
Process starts
    ↓
[load .env file via dotenv] (if present)
    ↓
[validateEnv()]
    ↓
  ┌─────────────────────────────────────────┐
  │ for each required var:                   │
  │   [is set?]                              │
  │     ├─ No → console.error + process.exit │
  │     └─ Yes → continue                    │
  │   [format valid?]                        │
  │     ├─ No → console.error + process.exit │
  │     └─ Yes → continue                    │
  └─────────────────────────────────────────┘
    ↓
[app setup continues]
    ↓
[server starts listening]
```

### Config / Env Changes

- NEW: `backend/src/utils/env.js` — environment variable validation utility
- CHANGED: `backend/src/index.js` — call `validateEnv()` at the top, before any setup
- NEW: `backend/.env.example` — document all required and optional env vars with descriptions
- CHANGED: `backend/.env` (if exists) — ensure all required vars are present

---

## Dependencies

- **None** — pure JavaScript validation
- **dotenv** — already used to load `.env` files

---

## Risks/Edge Cases

- **[Production env vars]**: CI/CD pipelines may not set all vars. Validate only in development? No — validate everywhere.
- **[Secret rotation]**: If JWT_SECRET changes, all existing tokens become invalid. Document this in migration notes.
- **[Local development]**: Provide `.env.example` with placeholder values.
- **[CI/CD]**: Test pipelines must set all required env vars or disable validation for test environment.

---

*Ready for implementation phase.*
