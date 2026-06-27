# bp-48: Miscellaneous Infrastructure Improvements — Spec

**Target model**: Any (small, straightforward edits)
**Date**: 2026-06-27

## Task 1: Remove axios — Frontend

### MODIFY: `frontend/package.json`

Remove line 21: `"axios": "^1.6.2",`

**Expected**: `dependencies` field becomes:
```json
"dependencies": {
    "@heroicons/vue": "^2.1.1",
    "pinia": "^2.1.7",
    "vue": "^3.3.11",
    "vue-i18n": "^9.7.0",
    "vue-router": "^4.2.5"
}
```

**Verification**: `grep -r "axios" frontend/src/` → no matches. `npm ls axios` → "(empty)".

---

## Task 2: Remove axios — Backend

### MODIFY: `backend/package.json`

Remove line 18: `"axios": "^1.6.2",`

### MODIFY: `backend/src/providers/generic/index.js`

**Remove** line 1: `const axios = require('axios');`

**Replace** `chat()` method (lines 14-37):

```javascript
async chat(messages, options = {}) {
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options.maxTokens || this.maxTokens,
        temperature: options.temperature ?? this.temperature,
        messages,
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`Chat API error: ${response.status} ${response.statusText}`);
    const data = await response.json();
    const choice = data.choices[0];
    return {
      content: choice.message.content,
      usage: data.usage,
      stop_reason: choice.finish_reason,
    };
}
```

**Replace** `validate()` method (lines 40-65):

```javascript
async validate() {
    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'test' }],
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (response.status === 401) return false;
      if (!response.ok) throw new Error(`Validate API error: ${response.status}`);
      return true;
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      throw error;
    }
}
```

---

## Task 3: Fix Auth Response Format

### MODIFY: `backend/src/api/routes.js`

**Register** (line 188):
```diff
- res.status(201).json({ ...result, message: 'Registration successful' });
+ res.status(201).json({ success: true, data: result, message: 'Registration successful' });
```

**Login** (line 244):
```diff
- res.json({ message: 'Login successful', ...result });
+ res.json({ success: true, data: result, message: 'Login successful' });
```

**Note**: `result` is `{ token, user }` from `registerUserBound` / `loginUserBound`. The wrapper makes it compatible with:
- Frontend `client.js:41`: `data.data !== undefined ? data.data : data` — extracts the `{ token, user }` object
- API contract: `{ success: true, data: { token, user } }` matches other endpoints

---

## Task 4: Pre-commit Hooks (husky + lint-staged)

### CREATE: `/package.json`

```json
{
  "name": "@vibecode/root",
  "private": true,
  "scripts": {
    "prepare": "husky"
  },
  "devDependencies": {
    "husky": "^9.0.11",
    "lint-staged": "^15.2.0"
  },
  "lint-staged": {
    "backend/src/**/*.js": "eslint --fix",
    "frontend/src/**/*.{js,ts,vue}": [
      "eslint --fix",
      "vue-tsc --noEmit --noEmitOnError false"
    ],
    "frontend/src/**/*.ts": "vue-tsc --noEmit"
  }
}
```

### CREATE: `/.husky/pre-commit`

```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

npx --no-install lint-staged
```

Make executable: `chmod +x .husky/pre-commit`

### Run setup

```bash
npm install          # installs husky + lint-staged in root
npx husky            # creates .husky/_/ directory and makes hook git-aware
```

---

## Task 5: Dependabot Config

### CREATE: `.github/dependabot.yml`

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/backend"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10

  - package-ecosystem: "npm"
    directory: "/frontend"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10

  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10

  - package-ecosystem: "maven"
    directory: "/agent"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10
```

---

## Task 6: DB Backup Script

### CREATE: `scripts/backup-db.sh`

```bash
#!/bin/bash
set -euo pipefail

CONTAINER="vibecode-postgres"
DB_USER="postgres"
OUTPUT="${1:-dump.sql}"

echo "Backing up all databases from container ${CONTAINER}..."
docker exec -t "${CONTAINER}" pg_dumpall -c -U "${DB_USER}" > "${OUTPUT}"
echo "Done. Backup written to ${OUTPUT}"
```

Make executable: `chmod +x scripts/backup-db.sh`

### Usage / Restore

```bash
# Backup
./scripts/backup-db.sh                     # writes dump.sql
./scripts/backup-db.sh backup-2026-06-27.sql

# Restore (new or existing database)
cat dump.sql | docker exec -i vibecode-postgres psql -U postgres -d vibecode

# Or into a local PostgreSQL instance
createdb -U postgres vibecode_restored
psql -U postgres -d vibecode_restored < dump.sql
```

---

## Task 7: Remove Root Dockerfile

### DELETE: `/Dockerfile`

```bash
git rm Dockerfile
```

**Rationale**: `docker-compose.yml` builds frontend via `frontend/Dockerfile` (line 41-43: `context: ./frontend, dockerfile: Dockerfile`). The root Dockerfile:
1. Has no matching root `package.json` (would fail at `COPY package*.json ./`)
2. Duplicates `frontend/Dockerfile` logic exactly
3. Misleads users who run `docker build .` expecting a build-all

---

## Test Expectations

```
✓ npm ls (backend) — no axios
✓ npm ls (frontend) — no axios
✓ node -e "require('./backend/src/providers/generic')" — no error
✓ curl -X POST localhost:3001/api/auth/register -d '{"email":"a@b.com","password":"X1y2!"}' -H 'Content-Type: application/json' | jq '.success' — true
✓ curl -X POST localhost:3001/api/auth/login -d '{"email":"a@b.com","password":"X1y2!"}' -H 'Content-Type: application/json' | jq '.success' — true
✓ npx lint-staged --dry-run — runs without error
✓ .husky/pre-commit — executable, runs lint-staged
✓ ./scripts/backup-db.sh — produces non-empty dump.sql
✓ git status — no Dockerfile in tracked files
```

## Edge Cases

1. **Backend fetch without polyfill**: The `node:18-alpine` image supports `fetch` natively. If someone runs on Node <18, they'll get a ReferenceError. Add a note in `backend/README.md` requiring Node >= 18.
2. **husky prepare script**: Must run `npm install` in the root directory first. Document in README or AGENTS.md.
3. **lint-staged on backend**: Backend `eslint.config.js` uses CommonJS — works fine with `eslint --fix`. No typecheck needed for backend.
4. **Multiple dependabot entries for npm**: Three directories (`/backend`, `/frontend`, `/`) means Dependabot opens 3 separate PRs per npm audit. The limit of 10 open PRs per ecosystem prevents overload.
5. **pg_dumpall password prompt**: The `.pgpass` or `PGPASSWORD` env var is not set by default. The script assumes Docker container has no password prompt (trust auth). If password is set, add: `docker exec -e PGPASSWORD="${POSTGRES_PASSWORD}" -t ...`

## Existing Code Patterns to Follow

- Backend: CommonJS (`require`, `module.exports`); ESLint flat config
- Frontend: ESM (`import`/`export`); TypeScript + Vue
- Shell scripts: `set -euo pipefail` at top (see `backend/integration-test/run.sh` for precedent)
- Response format: `{ success: Boolean, data?: any, error?: { code: String, message: String } }`
- Git commits: Conventional commits (feat/fix/chore prefix)
