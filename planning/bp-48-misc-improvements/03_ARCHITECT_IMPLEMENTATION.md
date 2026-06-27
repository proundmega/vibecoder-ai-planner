# bp-48: Miscellaneous Infrastructure Improvements — Implementation

**Status**: planned
**Priority**: P3
**Effort**: Small
**Scope**: Backend, Frontend, DevOps

## Purpose
Tidy up 6 small issues across the repo that degrade developer experience, consistency, and operational safety.

## Implementation Order

1. **Remove axios from frontend** — simplest, no code changes
2. **Remove axios from backend + replace with fetch** — modify GenericProvider
3. **Fix auth response format** — routes.js register + login
4. **Add root package.json + husky + lint-staged** — pre-commit hooks
5. **Add dependabot config** — .github/dependabot.yml
6. **Add backup script** — scripts/backup-db.sh
7. **Delete root Dockerfile** — final cleanup

## Per-File Action Plan

### 1. `frontend/package.json` (MODIFY)

Remove line: `"axios": "^1.6.2",` from dependencies.

Verify with: `rg 'axios' frontend/ --include '*.{js,ts,vue}'` — should return no matches after removal.

### 2. `backend/package.json` (MODIFY)

Remove line: `"axios": "^1.6.2",` from dependencies.

### 3. `backend/src/providers/generic/index.js` (MODIFY)

Replace `axios` import and calls with native `fetch`:

**Before** (line 1):
```js
const axios = require('axios');
```

**After**:
```js
// Remove import entirely — using native fetch
```

**Before** (lines 14-37):
```js
async chat(messages, options = {}) {
    const response = await axios.post(
      `${this.baseURL}/chat/completions`,
      { model: this.model, max_tokens: options.maxTokens || this.maxTokens, temperature: options.temperature ?? this.temperature, messages },
      { headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }, timeout: 60000 }
    );
    const choice = response.data.choices[0];
    return { content: choice.message.content, usage: response.data.usage, stop_reason: choice.finish_reason };
}
```

**After**:
```js
async chat(messages, options = {}) {
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, max_tokens: options.maxTokens || this.maxTokens, temperature: options.temperature ?? this.temperature, messages }),
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`Chat API error: ${response.status} ${response.statusText}`);
    const data = await response.json();
    const choice = data.choices[0];
    return { content: choice.message.content, usage: data.usage, stop_reason: choice.finish_reason };
}
```

**Before** (lines 40-65):
```js
async validate() {
    try {
      await axios.post(
        `${this.baseURL}/chat/completions`,
        { model: this.model, max_tokens: 1, messages: [{ role: 'user', content: 'test' }] },
        { headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }, timeout: 10000 }
      );
      return true;
    } catch (error) {
      if (error.response && error.response.status === 401) { return false; }
      throw error;
    }
}
```

**After**:
```js
async validate() {
    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, max_tokens: 1, messages: [{ role: 'user', content: 'test' }] }),
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

### 4. `backend/src/api/routes.js` (MODIFY)

**Register endpoint** — line 188:
```js
// Before:
res.status(201).json({ ...result, message: 'Registration successful' });

// After:
res.status(201).json({ success: true, data: result, message: 'Registration successful' });
```

**Login endpoint** — line 244:
```js
// Before:
res.json({ message: 'Login successful', ...result });

// After:
res.json({ success: true, data: result, message: 'Login successful' });
```

### 5. `/package.json` (CREATE)

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

### 6. `/.husky/pre-commit` (CREATE)

```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

npx --no-install lint-staged
```

### 7. `.github/dependabot.yml` (CREATE)

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

### 8. `scripts/backup-db.sh` (CREATE)

```bash
#!/bin/bash
# Database backup script for Vibecode AI Planner
#
# Usage:
#   ./scripts/backup-db.sh                    # dump to dump.sql
#   ./scripts/backup-db.sh my-backup.sql      # dump to custom filename
#
# Restore:
#   createdb -U postgres vibecode_new
#   psql -U postgres -d vibecode_new < dump.sql
#
# Or restore into running Docker postgres:
#   cat dump.sql | docker exec -i vibecode-postgres psql -U postgres -d vibecode

set -euo pipefail

CONTAINER="vibecode-postgres"
DB_USER="postgres"
OUTPUT="${1:-dump.sql}"

echo "Backing up all databases from container ${CONTAINER}..."
docker exec -t "${CONTAINER}" pg_dumpall -c -U "${DB_USER}" > "${OUTPUT}"
echo "Done. Backup written to ${OUTPUT}"
```

Make executable: `chmod +x scripts/backup-db.sh`

### 9. `/Dockerfile` (DELETE)

```bash
git rm Dockerfile
```

## Migration Plan
No database changes. No API contract changes (frontend `extractData` already handles both formats).

## Test Plan
1. `npm install` in both backend and frontend — no axios in node_modules
2. `node -e "new (require('./backend/src/providers/generic'))({baseUrl:'http://localhost:3001',apiKey:'test'})"` — no import error
3. `curl -X POST http://localhost:3001/api/auth/login -H 'Content-Type: application/json' -d '{"email":"t@t.com","password":"x"}'` — returns `{ success: true, data: { ... } }`
4. `npx lint-staged --dry-run` — correctly lists staged files
5. `./scripts/backup-db.sh` — produces valid SQL dump

## Rollback Steps
1. `git revert HEAD` (all changes in one commit)
2. Restore root Dockerfile: `git restore Dockerfile`
3. Reinstall deps: `npm install` in both packages
