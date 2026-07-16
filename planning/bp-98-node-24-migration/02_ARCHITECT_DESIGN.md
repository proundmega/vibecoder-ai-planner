# 02_ARCHITECT_DESIGN.md — Node 24 LTS Migration Design

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend | Frontend | CI/CD (Both)
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

The project is pinned to Node 18, which reaches end-of-life in April 2026. Node 24 LTS ("Krypton") provides security updates until April 2028. The project needs to migrate to Node 24 to maintain LTS support, benefit from V8 improvements, and align with the ecosystem's direction.

Recent Jenkins runs using `nodejs('Node')` resolved to Node 26.5.0 (not a configured version), causing transitive dependency failures. This highlights the risk of implicit Node version management — explicit version pinning is required.

---

## Current State

### Existing Backend
- `backend/package.json`: No `engines` field
- `backend/jest.config.js`: `maxWorkers: 1` (serial execution)
- Code: CommonJS (`require()`), no ESM
- Dependencies: Jest 29, supertest, ioredis, pg, winston, bcryptjs, jsonwebtoken
- Tested with: Node 20 (locally), Node 18 (CI)

### Existing Frontend
- `frontend/package.json`: `"engines": {"node": ">=18.0.0 <26.0.0"}`
- Code: TypeScript/Vue 3, uses Vitest, vue-tsc, vite 5
- Dependencies: vitest 1.x, vue-tsc 2.x, typescript 5.x, cypress 15.x
- Tested with: Node 20 (locally), Node 18 (CI)

### Existing CI/CD
- **GitHub Actions** (`.github/workflows/ci.yml`): `actions/setup-node@v3` with `node-version: '18'`
- **Jenkinsfile**: `nodejs('Node')` — Jenkins-managed tool, resolved to Node 26.5.0 recently
- **Local dev**: No `.nvmrc`, relies on system Node version

### Gap Analysis
- No explicit Node version enforcement in backend
- Frontend `engines` field blocks Node 24 (`<26.0.0` is fine, but lower bound is 18)
- GitHub Actions CI pins Node 18 explicitly
- Jenkins uses implicit tool resolution (unreliable)
- No `.nvmrc` for local dev consistency

---

## Design

### Option A: Clean Break to Node 24 (Recommended)

Set all version constraints to `>=24.0.0`, requiring Node 24 everywhere. This is a clean break with no backward compatibility concerns.

**Changes:**
```
backend/package.json    → engines: { "node": ">=24.0.0" }
frontend/package.json   → engines: { "node": ">=24.0.0" }
.github/workflows/ci.yml → node-version: '24'
Jenkinsfile             → nvm install 24 && nvm use 24 (replace nodejs('Node'))
.nvmrc                  → CREATE with "24"
AGENTS.md               → Update Quick Start and Gotchas sections
```

**Pros:**
- Clean, unambiguous version requirement
- No need to support old versions
- Aligns with LTS recommendation

**Cons:**
- Requires all developers to install Node 24
- CI/CD pipelines need Node 24 available

### Option B: Gradual Migration (Not Recommended)

Keep `>=18.0.0 <26.0.0` to allow Node 18-23 during transition.

**Pros:**
- Backward compatible
- Gradual rollout

**Cons:**
- Unnecessary complexity for an incubator project
- No production users to worry about
- Adds maintenance burden (supporting old versions)

**Decision**: Option A (clean break) is better for an incubator project with no production users.

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/package.json` | MODIFY | Add `"engines": { "node": ">=24.0.0" }` |
| `frontend/package.json` | MODIFY | Change engines to `{ "node": ">=24.0.0" }` |
| `.github/workflows/ci.yml` | MODIFY | Change `node-version: '18'` to `'24'` in both jobs |
| `Jenkinsfile` | MODIFY | Replace all `nodejs('Node')` blocks with explicit nvm + Node 24 |
| `.nvmrc` | CREATE | Add `24` |
| `AGENTS.md` | MODIFY | Update Quick Start, Gotchas, and commands sections |

---

## Data Flow Diagram

```
[Developer] → [nvm install 24] → [Node 24 runtime]
       ↓
[CI/CD] → [GitHub Actions: setup-node@v3 with node-version: '24']
[CI/CD] → [Jenkins: nvm install 24]
       ↓
[npm ci] → [Install dependencies] → [Run tests]
```

### Local Development Flow
1. Developer runs `nvm use` (reads `.nvmrc`)
2. Node 24 is activated
3. `npm ci` installs dependencies
4. `npm run dev` starts development server

### CI Flow (GitHub Actions)
1. `actions/setup-node@v3` installs Node 24
2. `npm ci` installs dependencies
3. Tests run with Node 24 runtime

### CI Flow (Jenkins)
1. `nvm install 24 && nvm use 24` activates Node 24
2. `npm ci` installs dependencies
3. Tests run with Node 24 runtime

---

## Dependencies

### Backend Dependencies
- Node 24 runtime (V8 engine improvements)
- npm 11 (ships with Node 24) — verify `npm ci` compatibility
- All existing npm packages must be compatible with Node 24's stricter TLS (OpenSSL 3.5)

### Frontend Dependencies
- Node 24 runtime
- npm 11 — verify `npm ci` compatibility
- `vue-tsc` 2.x — verify compatibility with Node 24's ESM resolution
- `vitest` 1.x — verify compatibility
- `cypress` 15.x — verify compatibility

### Cross-Cutting Dependencies
- GitHub Actions `actions/setup-node@v3` supports Node 24 (yes, it does — supports all LTS versions)
- Jenkins nvm plugin (must be available in Jenkins environment)

---

## Config / Environment Changes

- [x] New environment variables: **None** (no runtime config changes)
- [x] New database migrations: **None**
- [x] New npm dependencies: **None** (using existing packages)
- [x] Existing config changes: `engines` fields, CI node versions

---

## Database Changes

None. This is a configuration-only migration.

---

## Security Considerations

- Node 24 uses OpenSSL 3.5 with default security level 2
- Stricter cipher requirements may affect:
  - External API connections (verify all connections work)
  - PostgreSQL connections (pg driver supports OpenSSL 3.5)
  - Redis connections (ioredis supports OpenSSL 3.5)
- **Mitigation**: Test all external connections during verification

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Backend unit | Jest | `backend/src/__tests__/*.test.js` | Node 24 compatibility with existing tests |
| Frontend unit | Vitest | `frontend/src/__tests__/*.test.js` | Node 24 compatibility with Vue 3 tooling |
| Frontend typecheck | vue-tsc | `frontend/` | Node 24 compatibility with TypeScript |
| Frontend build | Vite | `frontend/` | Node 24 compatibility with build tooling |
| CI | GitHub Actions | `.github/workflows/ci.yml` | End-to-end CI with Node 24 |
| CI | Jenkinsfile | `Jenkinsfile` | End-to-end Jenkins with Node 24 |

### Verification Steps

1. **Local**: Install Node 24 via nvm, run full test suite
2. **Local**: Verify `npm ci` works with lockfiles
3. **CI**: Push to branch, verify GitHub Actions runs
4. **CI**: Push to PR, verify Jenkins runs

---

## Risks and Edge Cases

### Backend Risks
- **[npm 11 behavior]**: npm 11 may handle lockfiles differently. Mitigation: Verify `npm ci` works with existing `package-lock.json`
- **[Jest compatibility]**: Jest 29 may have issues with Node 24. Mitigation: Already tested locally, passes

### Frontend Risks
- **[vue-tsc ESM resolution]**: vue-tsc 2.x may fail with Node 24's stricter ESM. Mitigation: Already tested locally, passes
- **[cypress 15]**: Cypress may have Node 24 compatibility issues. Mitigation: Cypress 15.x supports Node 24

### Integration Risks
- **[Jenkins nvm availability]**: Jenkins environment may not have nvm installed. Mitigation: Use `actions/setup-node@v3` pattern or install nvm in pipeline
- **[GitHub Actions setup-node@v3]**: Verify `node-version: '24'` is supported (it is — supports all LTS versions)

### Edge Cases
- **Lockfile compatibility**: `package-lock.json` generated with npm 10 may need regeneration with npm 11
- **Docker images**: Development Docker Compose uses `node:20-alpine` — should be updated (deferred to bp-92)
- **Java agent Docker**: Uses `eclipse-temurin` (Java 17), not Node — no changes needed

---

## Alternative Designs Considered

### Alternative 1: Use `engines` field only (no CI changes)
- **Pros**: Minimal changes
- **Cons**: CI would still use Node 18, creating inconsistency
- **Decision**: Not chosen — CI must match local dev

### Alternative 2: Use Node 20 LTS instead of 24
- **Pros**: More conservative, longer track record
- **Cons**: Node 20 EOL April 2027 (1 year less than 24), Node 24 is current LTS
- **Decision**: Not chosen — Node 24 gives 2+ years of LTS

### Alternative 3: Gradual migration (keep `>=18.0.0 <26.0.0`)
- **Pros**: Backward compatible
- **Cons**: Unnecessary for incubator, adds maintenance burden
- **Decision**: Not chosen — clean break is better for incubator

---

## Pending Scope Items to Present to User

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

## Specification Generation

If a small model (7B–34B) will execute this ticket, the information above should be distilled into `04_SPECIFICATION.md` — a file that specifies exact file operations. The small model should not need to make any architecture decisions; those are encoded here.

- [ ] `04_SPECIFICATION.md` has been created with exact file operations for each file
- [ ] **Pending scope items presented to user**: All deferred improvements from previous tickets have been listed above and presented to the user

---

*This design document guides implementation. The key insight: this is a configuration-only migration with zero production code changes.*
