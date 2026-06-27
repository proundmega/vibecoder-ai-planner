# bp-42: Add Cypress E2E + Bash Integration Test Suite to CI — Implementation

**Status**: planned
**Priority**: P1
**Effort**: Medium
**Scope**: CI

## Purpose
Run integration and E2E tests in CI to catch regressions in real-DB and full-stack flows.

## Implementation Order

1. **Modify `backend/integration-test/run.sh`**
   - Accept `DATABASE_URL` from environment variable
   - Skip Docker Compose check if `DATABASE_URL` is set
   - Add `set -e` for fail-fast behavior
   - Keep backward compatibility for local Docker usage

2. **Add `frontend/package.json` script**
   - Add `"cypress:ci": "cypress run --e2e --headless --browser chrome"`

3. **Modify `.github/workflows/ci.yml`**
   - Add `integration` job (after backend, uses PG service)
   - Add `e2e` job (parallel with integration, uses PG service + build + cypress action)

## Per-File Action Plan

### `backend/integration-test/run.sh` (MODIFY)
```bash
set -e
DATABASE_URL="${DATABASE_URL:-postgresql://postgres:changeme@localhost:5432/vibecode}"
if [ -z "$DATABASE_URL" ]; then
  echo "Starting Docker Compose..."
  docker compose up -d postgres
  sleep 5
fi
export DATABASE_URL
cd "$(dirname "$0")/.."
npm run test:integration
```

### `frontend/package.json` (MODIFY)
Add to scripts:
```json
"cypress:ci": "cypress run --e2e --headless --browser chrome"
```

### `.github/workflows/ci.yml` (MODIFY)
After existing frontend job (or as last jobs in file):
```yaml
  integration:
    needs: [backend]
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_PASSWORD: changeme
          POSTGRES_DB: vibecode
        ports: ['5432:5432']
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
      - run: npm run test:integration
        working-directory: backend
        env:
          DATABASE_URL: postgresql://postgres:changeme@localhost:5432/vibecode

  e2e:
    needs: [backend, frontend]
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_PASSWORD: changeme
          POSTGRES_DB: vibecode
        ports: ['5432:5432']
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
      - run: npm ci
        working-directory: frontend
      - run: npm run migrate
        working-directory: backend
        env:
          DATABASE_URL: postgresql://postgres:changeme@localhost:5432/vibecode
      - name: Seed database
        run: npx tsx cypress/support/seed.ts
        working-directory: frontend
        env:
          DATABASE_URL: postgresql://postgres:changeme@localhost:5432/vibecode
      - run: npm run build
        working-directory: frontend
      - uses: cypress-io/github-action@v6
        with:
          working-directory: frontend
          start: npm run preview
          wait-on: 'http://localhost:3000'
          command: npm run cypress:ci
```

## Migration Plan
No database changes. No API changes.

## Test Plan
1. Push branch to GitHub, verify:
   - `integration` job starts, connects to PG, runs tests, passes
   - `e2e` job starts, seeds DB, builds frontend, starts preview, runs Cypress, passes
2. Check CI summary for clear pass/fail status per job

## Rollback Steps
1. Revert `ci.yml` to previous version
2. Revert `run.sh` if it broke local usage
3. Remove `cypress:ci` script from package.json
