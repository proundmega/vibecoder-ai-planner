# 03_ARCHITECT_IMPLEMENTATION.md — Node 24 LTS Migration Implementation

**Use this template for every ticket.** Copy this file into the ticket folder and fill in the sections.

---

## Ticket: bp-98 — Node 24 LTS Migration

**Status**: planned
**Priority**: P1
**Effort**: Medium
**Author**: AI Assistant
**Date created**: 2025-07-16
**Date completed**: YYYY-MM-DD
**PR**: [link]
**Branch**: [branch-name]
**Scope**: Backend | Frontend | CI/CD (Both)

**Dependencies**: None

---

### a) Purpose

Migrate the project from Node 18 to Node 24 LTS ("Krypton") across all environments. Node 18 reaches EOL in April 2026; Node 24 LTS runs until April 2028. This provides 2+ years of security updates, V8 performance improvements, and modern security defaults (OpenSSL 3.5).

---

### b) Actions

**CRITICAL**: Before implementing, verify this is a configuration-only migration. No production code changes are required.

#### Implementation Order

1. **[Create .nvmrc]** — `.nvmrc`
   - Add `24` to the file
   - *Depends on*: nothing

2. **[Update backend engines]** — `backend/package.json`
   - Add `"engines": { "node": ">=24.0.0" }`
   - *Depends on*: nothing

3. **[Update frontend engines]** — `frontend/package.json`
   - Change engines to `{ "node": ">=24.0.0" }`
   - *Depends on*: nothing

4. **[Update GitHub Actions CI]** — `.github/workflows/ci.yml`
   - Change `node-version: '18'` to `'24'` in both backend and frontend jobs
   - *Depends on*: nothing

5. **[Update Jenkinsfile]** — `Jenkinsfile`
   - Replace all `nodejs('Node')` blocks with explicit nvm + Node 24
   - *Depends on*: nothing

6. **[Update AGENTS.md]** — `AGENTS.md`
   - Update Quick Start section to mention Node 24
   - Update Gotchas section if applicable
   - *Depends on*: nothing

7. **[Verify tests pass]** — Local verification
   - Run `npm test` in `backend/`
   - Run `npm test -- --run` in `frontend/`
   - Run `npm run typecheck` in `frontend/`
   - Run `npm run build` in `frontend/`
   - *Depends on*: all file changes

---

### c) Per-File Action Plan

#### `.nvmrc` (CREATE)

- **Content**: `24`
- **Purpose**: Local development version pinning
- **Pattern**: Follows standard `.nvmrc` format (single line with version number)

#### `backend/package.json` (MODIFY)

- **Add**: `"engines": { "node": ">=24.0.0" }` after `devDependencies`
- **Logic**: Enforce Node 24+ for backend development
- **Position**: After `devDependencies` block, before closing `}`

#### `frontend/package.json` (MODIFY)

- **Change**: `"engines": { "node": ">=18.0.0 <26.0.0" }` → `"engines": { "node": ">=24.0.0" }`
- **Logic**: Enforce Node 24+ for frontend development
- **Position**: After `devDependencies` block

#### `.github/workflows/ci.yml` (MODIFY)

- **Change**: `node-version: '18'` → `node-version: '24'`
- **Lines to change**: Line 34 (backend job), Line 66 (frontend job)
- **Pattern**: Follow existing `actions/setup-node@v3` usage

#### `Jenkinsfile` (MODIFY)

- **Replace**: All `nodejs('Node') { ... }` blocks with explicit nvm scripts
- **Pattern**:
  ```groovy
  sh '''
      export NVM_DIR="$HOME/.nvm"
      [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
      nvm install 24
      nvm use 24
      [original commands]
  '''
  ```
- **Stages to update**: Backend Lint, Backend Syntax, Backend Unit Tests, Backend Coverage, Frontend Lint, Frontend Typecheck, Frontend Unit Tests, Frontend Coverage, Frontend Build, Contract Test, Integration Tests

#### `AGENTS.md` (MODIFY)

- **Update Quick Start**: Change "Node 18+" references to "Node 24 LTS"
- **Update Gotchas**: Add note about Node 24 requirement
- **Update Commands**: Ensure all commands are compatible with Node 24

---

### d) Dependencies

- [Node 24 runtime]: Required for all development and CI
- [npm 11]: Ships with Node 24, verify `npm ci` compatibility
- [nvm]: Required for Jenkins (unless Jenkins has Node 24 installed)
- [GitHub Actions setup-node@v3]: Supports Node 24 (all LTS versions)

---

### e) Risks/Edge Cases

- **[npm 11 lockfile format]**: npm 11 may generate slightly different `package-lock.json`. Mitigation: Commit regenerated lockfiles if needed
- **[vue-tsc ESM resolution]**: Node 24's stricter ESM may affect vue-tsc. Mitigation: Already tested locally, passes
- **[Jenkins nvm availability]**: Jenkins must have nvm installed. Mitigation: Verify in Jenkins environment
- **[OpenSSL 3.5 TLS]**: Stricter cipher requirements. Mitigation: Test all external connections

---

### f) Testing

#### Backend Unit Tests
- [ ] `npm test` — all unit tests pass
- [ ] `npm run test:coverage` — coverage threshold passes (60%)
- [ ] `npm run lint` — no lint errors

#### Frontend Unit Tests
- [ ] `npm test -- --run` — all unit tests pass
- [ ] `npm test -- --run --coverage` — coverage threshold passes (60%)
- [ ] `npm run lint` — no lint errors
- [ ] `npm run typecheck` — TypeScript compilation passes
- [ ] `npm run build` — production build passes

#### CI Verification
- [ ] GitHub Actions CI runs successfully (backend + frontend jobs)
- [ ] Jenkins CI runs successfully (all stages)

---

### g) Migration Notes (if applicable)

None. This is a configuration-only migration. No database changes, no API changes.

---

### h) Files Changed

**Configuration:**
```
.nvmrc                          → CREATE (add "24")
backend/package.json            → MODIFY (add engines field)
frontend/package.json           → MODIFY (update engines field)
.github/workflows/ci.yml        → MODIFY (change node-version to '24')
Jenkinsfile                     → MODIFY (replace nodejs('Node') with nvm + Node 24)
AGENTS.md                       → MODIFY (update documentation)
```

---

### i) Code Review Checklist

- [ ] `.nvmrc` contains `24`
- [ ] `backend/package.json` has `"engines": { "node": ">=24.0.0" }`
- [ ] `frontend/package.json` has `"engines": { "node": ">=24.0.0" }`
- [ ] `.github/workflows/ci.yml` uses `node-version: '24'` in both jobs
- [ ] `Jenkinsfile` uses explicit nvm + Node 24 in all stages
- [ ] `AGENTS.md` updated to reflect Node 24 requirement
- [ ] All tests pass with Node 24
- [ ] No production code changes (this is configuration-only)
- [ ] Lockfiles compatible with npm 11 (verify with `npm ci`)

---

### j) Post-Deploy Verification

1. [ ] Local: `nvm use` activates Node 24
2. [ ] Local: `npm ci` installs dependencies successfully
3. [ ] Local: `npm test` passes (backend)
4. [ ] Local: `npm test -- --run` passes (frontend)
5. [ ] Local: `npm run typecheck` passes (frontend)
6. [ ] Local: `npm run build` passes (frontend)
7. [ ] GitHub Actions CI runs successfully
8. [ ] Jenkins CI runs successfully

---

### Pending Scope Items to Present to User

**MANDATORY**: Before presenting this ticket to the user, list all deferred improvements found in previous tickets' "Out of Scope" sections that are relevant to this ticket's domain.

### Items to Present

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

*Fill in all sections before starting implementation. This is a low-risk configuration migration with clear acceptance criteria.*
