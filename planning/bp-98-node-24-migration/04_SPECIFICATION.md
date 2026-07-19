# 04_SPECIFICATION.md — Model Execution Spec

**Use this file when a small model (7B–34B) will execute the ticket.**  
This file bridges the planning docs (01–03) and the code. It specifies exact file operations, imports, function signatures, test expectations, and edge cases. The model should not need to make any architecture decisions — those are already encoded here.

**Generated from**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`
**Target model**: 34B local model
**Date**: 2025-07-16

---

## Test-First Requirement

**NOT APPLICABLE** — This is a configuration-only migration with zero production code changes. No test files need to be created or modified.

---

## File Operations

### CREATE: `.nvmrc`

**Content** (exact):
```
24
```

**Purpose**: Local development Node version pinning. `nvm use` reads this file.

---

### MODIFY: `backend/package.json`

**Add** after the `devDependencies` closing `}`:
```json
  },
  "engines": {
    "node": ">=24.0.0"
  }
}
```

**Position**: After the last line of `devDependencies`, before the final `}`.

**Example** (before):
```json
  "devDependencies": {
    "eslint": "^8.54.0",
    "supertest": "^6.3.3"
  }
}
```

**Example** (after):
```json
  "devDependencies": {
    "eslint": "^8.54.0",
    "supertest": "^6.3.3"
  },
  "engines": {
    "node": ">=24.0.0"
  }
}
```

---

### MODIFY: `frontend/package.json`

**Change** the existing `engines` field:

**Before**:
```json
  "engines": {
    "node": ">=18.0.0 <26.0.0"
  }
```

**After**:
```json
  "engines": {
    "node": ">=24.0.0"
  }
```

**Position**: After `devDependencies`, before closing `}`.

---

### MODIFY: `backend/Dockerfile`

**Change** all `node:18-alpine` to `node:24-alpine`:

**Before** (line 1 and line 6):
```dockerfile
FROM node:18-alpine AS deps
...
FROM node:18-alpine
```

**After**:
```dockerfile
FROM node:24-alpine AS deps
...
FROM node:24-alpine
```

**Pattern**: Search for `node:18-alpine` and replace with `node:24-alpine`.

---

### MODIFY: `backend/Dockerfile.test`

**Change** all `node:18-alpine` to `node:24-alpine`:

**Before** (line 1 and line 6):
```dockerfile
FROM node:18-alpine AS deps
...
FROM node:18-alpine
```

**After**:
```dockerfile
FROM node:24-alpine AS deps
...
FROM node:24-alpine
```

**Pattern**: Search for `node:18-alpine` and replace with `node:24-alpine`.

---

### MODIFY: `frontend/Dockerfile`

**Change** `node:18-alpine` to `node:24-alpine`:

**Before** (line 1):
```dockerfile
FROM node:18-alpine AS builder
```

**After**:
```dockerfile
FROM node:24-alpine AS builder
```

**Pattern**: Search for `node:18-alpine` and replace with `node:24-alpine`.

---

### VERIFY: `Jenkinsfile`

**Status**: Already uses `nvm install 24 && nvm use 24` from bp-99. No changes needed.

**Verify** all stages use Node 24:
- Backend Lint, Backend Syntax, Backend Unit Tests, Backend Coverage
- Frontend Lint, Frontend Typecheck, Frontend Unit Tests, Frontend Coverage
- Frontend Build, Contract Test, Integration Tests

All should already have `nvm install 24` and `nvm use 24` from the bp-99 fix.

---

### MODIFY: `AGENTS.md`

**Update** the following sections:

1. **Quick Start** — Change Node version references:
   - Before: `Node 18+` or `Node 18`
   - After: `Node 24 LTS`

2. **Gotchas** — Add or update Node version note:
   - Add: `Backend requires Node 24 LTS (not 18 or 20). Use nvm to switch versions.`

3. **Commands** — Ensure all commands are compatible with Node 24 (no changes needed, but verify)

**Search patterns**:
- `node:18-alpine` → `node:24-alpine` (in Dockerfile references)
- `Node 18` → `Node 24 LTS`

---

### MODIFY: `AGENTS.md`

**Update** the following sections:

1. **Quick Start** — Change Node version references:
   - Before: `Node 18+` or `Node 18`
   - After: `Node 24 LTS`

2. **Gotchas** — Add or update Node version note:
   - Add: `Backend requires Node 24 LTS (not 18 or 20). Use nvm to switch versions.`

3. **Commands** — Ensure all commands are compatible with Node 24 (no changes needed, but verify)

**Search patterns**:
- `node-version: '18'` → `node-version: '24'`
- `Node 18` → `Node 24 LTS`
- `nodejs('Node')` → reference to nvm + Node 24

---

## Test Expectations

**NOT APPLICABLE** — No test files need to be created or modified. This is a configuration-only migration.

**Verification steps** (manual, not automated tests):
1. `nvm use` activates Node 24
2. `npm ci` installs dependencies successfully
3. `npm test` passes (backend)
4. `npm test -- --run` passes (frontend)
5. `npm run typecheck` passes (frontend)
6. `npm run build` passes (frontend)
7. Docker images build successfully with `docker compose up --build`
8. Jenkins CI runs successfully

---

## Edge Cases to Handle

1. **[npm 11 lockfile format]**: npm 11 (shipped with Node 24) may generate slightly different `package-lock.json`. If `npm ci` fails, regenerate lockfiles with `npm install` on Node 24.
2. **[vue-tsc ESM resolution]**: Node 24's stricter ESM may affect vue-tsc. If vue-tsc fails, verify `@volar/typescript` is installed correctly.
3. **[Jenkins nvm availability]**: Jenkins environment must have nvm installed (already configured in Jenkinsfile from bp-99).
4. **[OpenSSL 3.5 TLS]**: Node 24 uses OpenSSL 3.5 with stricter cipher requirements. If any external connection fails, verify the target supports modern TLS.

---

## Existing Code Patterns to Follow

- `.nvmrc` format: Single line with version number (e.g., `24`)
- `engines` field format: `"engines": { "node": ">=X.Y.Z" }`
- Docker pattern: `FROM node:XX-alpine` (change all occurrences)
- Jenkins pattern: `sh ''' ... '''` with nvm setup + commands

---

## Pending Scope Items

**All deferred improvements from previous tickets' "Out of Scope" sections that are relevant to this ticket have been presented to the user in the 01/02/03 documents above.**

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-58 | HTTPS termination (reverse proxy) | Security | bp-87-https-termination | ☐ |
| 2 | bp-58 | Secrets management (Vault, etc.) | Security | bp-88-secrets-management | ☐ |
| 3 | bp-60 | Frontend E2E tests in Cypress | Testing | bp-89-frontend-e2e-cypress | ☐ |
| 4 | bp-99 | Java agent unit tests | Testing | bp-90-java-agent-tests | ☐ |
| 5 | bp-99 | Prometheus metrics for agent health | Observability | bp-76-prometheus-metrics | ☐ |
| 6 | bp-99 | Runtime provider config reload | Developer Experience | bp-91-provider-reload | ☐ |

**All items above must be presented to the user before ticket approval.**

---

## Files NOT to Change

- `backend/src/` — No production code changes
- `frontend/src/` — No production code changes
- `migrations/` — No database changes
- `Dockerfile*` / `docker-compose*.yml` — Docker updates deferred to bp-92
- `agent/` — Java agent uses eclipse-temurin (not Node)

---

*This specification is the contract between planning and execution. This is a configuration-only migration — no code changes required.*
