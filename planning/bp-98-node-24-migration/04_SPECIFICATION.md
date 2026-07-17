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

### MODIFY: `.github/workflows/ci.yml`

**Change** line 34 (backend job):
```yaml
# Before
node-version: '18'
# After
node-version: '24'
```

**Change** line 66 (frontend job):
```yaml
# Before
node-version: '18'
# After
node-version: '24'
```

**Pattern**: Search for `node-version: '18'` and replace with `node-version: '24'`.

---

### MODIFY: `Jenkinsfile`

**Replace** all `nodejs('Node') { ... }` blocks with explicit nvm scripts.

**Pattern** for each stage:

**Before**:
```groovy
stage('Backend Lint') {
    steps {
        nodejs('Node') {
            dir('backend') {
                sh 'npm ci'
                sh 'npm run lint'
            }
        }
    }
}
```

**After**:
```groovy
stage('Backend Lint') {
    steps {
        dir('backend') {
            sh '''
                export NVM_DIR="$HOME/.nvm"
                [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
                nvm install 24
                nvm use 24
                npm ci
                npm run lint
            '''
        }
    }
}
```

**Stages to update**:
1. Backend Lint
2. Backend Syntax
3. Backend Unit Tests
4. Backend Coverage
5. Frontend Lint
6. Frontend Typecheck
7. Frontend Unit Tests
8. Frontend Coverage
9. Frontend Build
10. Contract Test
11. Integration Tests

**Note**: The Integration Tests stage already uses `dir('backend')` with a single `sh` block — just change `nvm install 18` to `nvm install 24` and `nvm use 18` to `nvm use 24`.

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
7. GitHub Actions CI runs successfully
8. Jenkins CI runs successfully

---

## Edge Cases to Handle

1. **[npm 11 lockfile format]**: npm 11 (shipped with Node 24) may generate slightly different `package-lock.json`. If `npm ci` fails, regenerate lockfiles with `npm install` on Node 24.
2. **[vue-tsc ESM resolution]**: Node 24's stricter ESM may affect vue-tsc. If vue-tsc fails, verify `@volar/typescript` is installed correctly.
3. **[Jenkins nvm availability]**: Jenkins environment must have nvm installed. If nvm is not available, install it in the pipeline or configure a Jenkins-managed Node 24 tool.
4. **[OpenSSL 3.5 TLS]**: Node 24 uses OpenSSL 3.5 with stricter cipher requirements. If any external connection fails, verify the target supports modern TLS.

---

## Existing Code Patterns to Follow

- `.nvmrc` format: Single line with version number (e.g., `24`)
- `engines` field format: `"engines": { "node": ">=X.Y.Z" }`
- GitHub Actions pattern: `actions/setup-node@v3` with `node-version: 'XX'`
- Jenkins pattern: `sh ''' ... '''` with nvm setup + commands

---

## Pending Scope Items

**All deferred improvements from previous tickets' "Out of Scope" sections that are relevant to this ticket have been presented to the user in the 01/02/03 documents above.**

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-60 | CI integration (separate Jenkins job) | CI/CD | bp-98-node-24-migration | ☐ |
| 2 | bp-58 | HTTPS termination (reverse proxy) | Security | bp-87-https-termination | ☐ |
| 3 | bp-58 | Secrets management (Vault, etc.) | Security | bp-88-secrets-management | ☐ |
| 4 | bp-60 | Frontend E2E tests in Cypress | Testing | bp-89-frontend-e2e-cypress | ☐ |
| 5 | bp-99 | Java agent unit tests | Testing | bp-90-java-agent-tests | ☐ |
| 6 | bp-99 | Prometheus metrics for agent health | Observability | bp-76-prometheus-metrics | ☐ |
| 7 | bp-99 | Runtime provider config reload | Developer Experience | bp-91-provider-reload | ☐ |

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
