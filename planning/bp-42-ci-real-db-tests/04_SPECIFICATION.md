# bp-42: Add Cypress E2E + Bash Integration Test Suite to CI — Spec

**Target model**: 7B–14B (YAML, bash, JSON)
**Date**: 2026-06-27

## File Operations

### MODIFY: `.github/workflows/ci.yml`

**Append two new jobs** after the `frontend` job:

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
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Install backend deps
        run: npm ci
        working-directory: backend
      - name: Run migrations
        run: npm run migrate
        working-directory: backend
        env:
          DATABASE_URL: postgresql://postgres:changeme@localhost:5432/vibecode
      - name: Run integration tests
        run: npm run test:integration
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
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Install backend deps
        run: npm ci
        working-directory: backend
      - name: Install frontend deps
        run: npm ci
        working-directory: frontend
      - name: Run migrations
        run: npm run migrate
        working-directory: backend
        env:
          DATABASE_URL: postgresql://postgres:changeme@localhost:5432/vibecode
      - name: Seed database
        run: npx tsx cypress/support/seed.ts
        working-directory: frontend
        env:
          DATABASE_URL: postgresql://postgres:changeme@localhost:5432/vibecode
      - name: Build frontend
        run: npm run build
        working-directory: frontend
      - name: Cypress E2E
        uses: cypress-io/github-action@v6
        with:
          working-directory: frontend
          start: npm run preview
          wait-on: 'http://localhost:3000'
          command: npm run cypress:ci
```

### MODIFY: `backend/integration-test/run.sh`

**Changes**:
```bash
#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
DATABASE_URL="${DATABASE_URL:-}"

if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL not set. Starting Docker Compose with postgres..."
  cd "$DIR/.."
  docker compose up -d postgres
  sleep 3
  DATABASE_URL="postgresql://postgres:changeme@localhost:5432/vibecode"
fi

export DATABASE_URL
cd "$DIR/.."
echo "Running integration tests against $DATABASE_URL"
npm run migrate
npm run test:integration
```

### MODIFY: `frontend/package.json`

**Add to `scripts`**:
```json
"cypress:ci": "cypress run --e2e --headless --browser chrome"
```

## Test Expectations

```
✓ integration job starts, spins up PG, runs migrations, executes test:integration, passes
✓ e2e job starts, spins up PG, seeds DB, builds frontend, starts preview, runs Cypress, passes
✓ Both jobs report pass/fail independently in CI summary
✓ run.sh works locally (Docker Compose path) and in CI (env var path)
```

## Edge Cases

1. **PG not ready**: health checks retry with 5 attempts × 10s intervals
2. **Seed script fails**: Cypress step won't start (fail-fast)
3. **Integration tests fail**: CI shows red on integration job, green on others — clear failure isolation
4. **Port conflicts on 5432**: Service container binds to 5432 only — unlikely in GA runners
