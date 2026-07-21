# 01_ARCHITECT_REQUIREMENT.md — Node 24 LTS Migration

**Status**: completed
**Date created**: 2025-07-16
**Date completed**: 2026-07-21
**Author**: AI Assistant
**Scope**: Backend | Frontend | CI/CD (Jenkins only)
**Priority**: P1
**Effort**: Medium

---

## Requirement

Migrate the project from Node 18 to Node 24 LTS ("Krypton") across all environments: local development and Jenkins CI.

**Why**: Node 18 reaches end-of-life in April 2026. Node 24 LTS runs until April 2028, providing 2+ years of security updates. Node 24 includes stricter runtime validation, better ESM/CJS interoperability, modern Web API support, and OpenSSL 3.5 security hardening.

**Problem**: The project is currently pinned to Node 18 in `engines` fields and Docker images. The `engines` field currently blocks Node 24 (`>=18 <26`). Developers are seeing Node runtime warnings and errors that Node 24's stricter validation would surface earlier. Jenkins uses explicit nvm scripts (already fixed from `nodejs('Node')`), but the project's configuration still references Node 18/20.

**Value**: 2+ years of LTS support, modern security defaults, better module resolution, elimination of Node runtime warnings/errors through stricter validation, and alignment with the Node.js ecosystem's current direction.

---

## Existing Infrastructure Audit

### Backend
- `backend/package.json`: No `engines` field (currently no version constraint)
- `backend/jest.config.js`: `maxWorkers: 1` (serial execution)
- `backend/src/`: CommonJS (`require()`), no ESM usage
- Dependencies: Jest 29, supertest, ioredis, pg, winston, bcryptjs, jsonwebtoken — all tested with Node 20

### Frontend
- `frontend/package.json`: Has `"engines": {"node": ">=18.0.0 <26.0.0"}`
- `frontend/src/`: TypeScript/Vue 3, uses Vitest, vue-tsc, vite 5
- Dependencies: vitest 1.x, vue-tsc 2.x, typescript 5.x, cypress 15.x

### CI/CD
- **Jenkinsfile**: Uses explicit `nvm install 24 && nvm use 24` in all stages (already fixed from `nodejs('Node')` in bp-99/fix/jenkins-pipeline-lint)
- **Docker images**: `backend/Dockerfile` uses `node:18-alpine`, `backend/Dockerfile.test` uses `node:18-alpine`, `frontend/Dockerfile` uses `node:18-alpine`
- `.nvmrc`: Does not exist

### Key Insight

This is a **configuration-only migration** — no production code changes required. The project is already using CommonJS, modern tooling, and has no ESM dependencies. Node 24's ESM-first module resolution is stricter but shouldn't break CommonJS code. The main risk is transitive dependency compatibility with Node 24's stricter validation.

---

## Scope

### In Scope
- [ ] Update `backend/package.json` engines field to `>=24.0.0`
- [ ] Update `frontend/package.json` engines field to `>=24.0.0`
- [ ] Update `Jenkinsfile` to use `nvm install 24 && nvm use 24` (already done in bp-99, verify it's correct)
- [ ] Create `.nvmrc` file with `24` for local development consistency
- [ ] Update Docker base images to `node:24-alpine` (backend/Dockerfile, backend/Dockerfile.test, frontend/Dockerfile)
- [ ] Verify all tests pass with Node 24
- [ ] Update `AGENTS.md` documentation to reflect Node 24 requirement

### Out of Scope
- [ ] Upgrading to Node 20 first (we're going directly to 24)
- [ ] Migrating to ESM modules (project uses CommonJS, no plans to change)
- [ ] Node 24-specific feature adoption (CloseEvent, Float16Array, URLPattern, etc.)
- [ ] Upgrading npm to latest (Node 24 ships with npm 11, which is fine)
- [ ] Java agent Node.js version (agents use their own Docker image, not Node)
- [ ] Docker base image updates (eclipse-temurin for Java, node:24-alpine for Node containers)

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

**All items above should be presented to the user before ticket approval.**

---

## Deferred Improvements Found (Internal Tracking)

| # | From Ticket | Improvement | Category | Suggested Next Ticket |
|---|-------------|-------------|----------|----------------------|
| 1 | bp-60 | CI integration (separate Jenkins job) | CI/CD | bp-98-node-24-migration |
| 2 | bp-58 | HTTPS termination (reverse proxy) | Security | bp-87-https-termination |
| 3 | bp-58 | Secrets management (Vault, etc.) | Security | bp-88-secrets-management |
| 4 | bp-60 | Frontend E2E tests in Cypress | Testing | bp-89-frontend-e2e-cypress |
| 5 | bp-99 | Java agent unit tests | Testing | bp-90-java-agent-tests |
| 6 | bp-99 | Prometheus metrics for agent health | Observability | bp-76-prometheus-metrics |
| 7 | bp-99 | Runtime provider config reload | Developer Experience | bp-91-provider-reload |

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/package.json` | MODIFY | Add engines field `>=24.0.0` |
| `frontend/package.json` | MODIFY | Update engines field to `>=24.0.0` |
| `backend/Dockerfile` | MODIFY | Change `node:18-alpine` to `node:24-alpine` |
| `backend/Dockerfile.test` | MODIFY | Change `node:18-alpine` to `node:24-alpine` |
| `frontend/Dockerfile` | MODIFY | Change `node:18-alpine` to `node:24-alpine` |
| `Jenkinsfile` | MODIFY | Update nvm to Node 24 (already fixed from nodejs('Node')) |
| `.nvmrc` | CREATE | Add `24` for local development |
| `AGENTS.md` | MODIFY | Update Quick Start and gotchas sections |

---

## Known Unknowns

1. **[npm 11 compatibility]**: Node 24 ships with npm 11 by default. Has `npm ci` behavior changed? Need to verify with a clean install.
2. **[vue-tsc compatibility]**: `vue-tsc` 2.x may have issues with Node 24's stricter ESM resolution. Already seen breakage with Node 26.
3. **[Jenkins Node 24 availability]**: Does the Jenkins infrastructure have Node 24 installed, or will nvm be required?
4. **[Docker base images]**: Should we also update Docker base images to `node:24-alpine`? (Included in scope for this ticket)

---

## Important Design Decisions

**DECISION POINTS** — Items that need user confirmation.

1. **Node version constraint**: Should the `engines` field use `>=24.0.0` (strict) or `>=18.0.0 <26.0.0` (allow 18-23 for gradual migration)?
   - **Recommendation**: `>=24.0.0` — clean break, no need to support old versions
   - **Alternative**: Keep `>=18.0.0 <26.0.0` for backward compatibility during transition

2. **Jenkins tool configuration**: Already fixed — uses explicit nvm scripts (from bp-99). Verify Node 24 is used.
    - **Status**: Already resolved — `nvm install 24 && nvm use 24` in all stages

3. **Docker images**: Should Node 24 Docker base image updates be included in this ticket?
    - **Recommendation**: Include now for consistency — all environments should use Node 24
    - **Alternative**: Defer to a follow-up ticket (bp-92-docker-updates)

---

## Acceptance Criteria

1. [ ] `.nvmrc` exists with `24`
2. [ ] `backend/package.json` engines field updated to `>=24.0.0`
3. [ ] `frontend/package.json` engines field updated to `>=24.0.0`
4. [ ] `backend/Dockerfile` uses `node:24-alpine`
5. [ ] `backend/Dockerfile.test` uses `node:24-alpine`
6. [ ] `frontend/Dockerfile` uses `node:24-alpine`
7. [ ] `Jenkinsfile` uses `nvm install 24 && nvm use 24` in all stages
8. [ ] `AGENTS.md` updated to reflect Node 24 requirement in Quick Start and Gotchas
9. [ ] All backend tests pass with Node 24 (`npm test` in `backend/`)
10. [ ] All frontend tests pass with Node 24 (`npm test -- --run` in `frontend/`)
11. [ ] Backend lint passes (`npm run lint` in `backend/`)
12. [ ] Frontend lint passes (`npm run lint` in `frontend/`)
13. [ ] Frontend typecheck passes (`npm run typecheck` in `frontend/`)
14. [ ] Frontend build passes (`npm run build` in `frontend/`)
15. [ ] Docker images build successfully with Node 24 base
16. [ ] Jenkins CI runs successfully with Node 24

---

## Out of Scope

- Docker base image updates (tracked separately)
- Java agent Node.js version (agents use eclipse-temurin Docker image)
- ESM migration (project uses CommonJS)
- Node 24-specific feature adoption
- npm 11 migration guide (npm 11 works with existing lockfiles)
- Gradual migration from Node 18 (doing a clean break to 24)

---

## Performance Considerations

- Node 24 includes V8 improvements over Node 18 (faster JIT, better garbage collection)
- Expected: neutral-to-positive performance impact
- No performance testing required for this migration

---

## Security Considerations

- Node 24 uses OpenSSL 3.5 with default security level 2 (stricter cipher requirements)
- This may affect:
  - External API connections requiring weak ciphers (unlikely in modern APIs)
  - PostgreSQL connections (pg driver supports OpenSSL 3.5)
  - Redis connections (ioredis supports OpenSSL 3.5)
- **Action**: Verify all external connections work with Node 24's stricter TLS defaults during testing

---

## Testing Checklist

### Backend Tests
- [ ] `npm test` — all unit tests pass
- [ ] `npm run test:coverage` — coverage threshold passes (60%)
- [ ] `npm run lint` — no lint errors

### Frontend Tests
- [ ] `npm test -- --run` — all unit tests pass
- [ ] `npm test -- --run --coverage` — coverage threshold passes (60%)
- [ ] `npm run lint` — no lint errors
- [ ] `npm run typecheck` — TypeScript compilation passes
- [ ] `npm run build` — production build passes

### CI Verification
- [ ] Jenkins CI runs successfully (all stages)

---

## Anti-Patterns to Avoid

- ❌ **Changing production code** — this is a configuration-only migration
- ❌ **Leaving `nodejs('Node')` in Jenkinsfile** — must use explicit nvm
- ❌ **Forgetting `.nvmrc`** — needed for local dev consistency
- ❌ **Skipping documentation updates** — `AGENTS.md` must reflect new version
- ❌ **Testing only with Node 24** — verify lockfiles work with `npm ci` (simulates CI)

---

*Fill in all sections before starting implementation. This is a low-risk configuration migration with clear acceptance criteria.*
