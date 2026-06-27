# bp-42: Add Cypress E2E + Bash Integration Test Suite to CI — Design

**Status**: planned
**Date created**: 2026-06-27
**Scope**: CI

## Current State

GitHub Actions pipeline has two jobs:
1. `backend` — lint → unit test
2. `frontend` — lint → typecheck → build

Neither job runs integration or E2E tests.

## Proposed Solution

### New Jobs

```
ci.yml
├── backend (lint → test)
├── frontend (lint → typecheck → build)
├── integration (pg-service → run integration tests)
└── e2e (pg-service → seed → build → preview → cypress run)
```

### Job: integration

```yaml
integration:
  runs-on: ubuntu-latest
  services:
    postgres:
      image: postgres:16
      env:
        POSTGRES_PASSWORD: changeme
        POSTGRES_DB: vibecode
      options: >-
        --health-cmd pg_isready
        --health-interval 10s
        --health-timeout 5s
        --health-retries 5
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 20 }
    - run: npm ci
      working-directory: backend
    - run: npm run migrate
      working-directory: backend
      env:
        DATABASE_URL: postgresql://postgres:changeme@localhost:5432/vibecode
    - run: DATABASE_URL=postgresql://postgres:changeme@localhost:5432/vibecode npm run test:integration
      working-directory: backend
```

### Job: e2e

```yaml
e2e:
  runs-on: ubuntu-latest
  services:
    postgres:
      image: postgres:16
      env:
        POSTGRES_PASSWORD: changeme
        POSTGRES_DB: vibecode
      options: ...
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 20 }
    - run: npm ci
      working-directory: backend
    - run: npm ci
      working-directory: frontend
    - run: npm run migrate
      working-directory: backend
      env:
        DATABASE_URL: postgresql://postgres:changeme@localhost:5432/vibecode
    - name: Seed DB
      run: npx tsx cypress/support/seed.ts
      working-directory: frontend
      env:
        DATABASE_URL: postgresql://postgres:changeme@localhost:5432/vibecode
    - run: npm run build
      working-directory: frontend
    - name: Start Vite preview & run Cypress
      uses: cypress-io/github-action@v6
      with:
        working-directory: frontend
        build: npm run build
        start: npm run preview
        wait-on: 'http://localhost:3000'
        command: npm run cypress:ci
```

### run.sh Modification

The bash integration script currently assumes Docker Compose. Modify it to:
- Accept `DATABASE_URL`, `ALLOWED_ORIGINS` as env vars (overriding defaults)
- Run `npm run test:integration` directly (Jest integration config already targets `${DATABASE_URL}`)
- Fail loudly on first error (`set -e`)

### cypress:ci Script

Add to `frontend/package.json`:
```json
"cypress:ci": "cypress run --e2e --headless --browser chrome"
```

## Alternatives Considered

- **Docker Compose in CI**: Rejected — native service containers are simpler and officially supported
- **Single job for everything**: Rejected — 15+ minute wall time, poor failure isolation
- **Cypress dashboard**: Optional, can be added later; not in scope

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `.github/workflows/ci.yml` | MODIFY | Add `integration` and `e2e` jobs |
| `backend/integration-test/run.sh` | MODIFY | Accept DATABASE_URL from env, remove hardcoded `docker compose` assumption |
| `frontend/package.json` | MODIFY | Add `cypress:ci` script |
