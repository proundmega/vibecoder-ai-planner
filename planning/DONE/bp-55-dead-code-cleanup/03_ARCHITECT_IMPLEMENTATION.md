# 03_ARCHITECT_IMPLEMENTATION.md — Dead Code and Stale File Cleanup

**Status**: planned
**Priority**: P3
**Effort**: Medium
**Author**: AI Assistant
**Date created**: {{YYYY-MM-DD}}
**Date completed**: {{YYYY-MM-DD}}
**PR**: {{link}}
**Branch**: {{branch-name}}
**Scope**: Both

**Dependencies**: None

---

### a) Purpose

Remove dead code, unused dependencies, broken files, stale config, and redundant documentation to reduce clutter, CI time, and cognitive load.

---

### b) Actions

#### Implementation Order

Steps must be executed in this exact order (each has a verification step):

1. **Verify all dead dependencies** — `backend/` and `frontend/`
   - Run grep searches to confirm each dependency is unused
   - Check both `src/` and `cypress/` directories
   - Also check for dynamic requires (`require('axios')` without import)
   - *Depends on*: nothing

2. **Remove backend dead deps** — `backend/package.json`
   - Remove `axios`, `slugify` from `dependencies`
   - Run `npm install` (regenerates lockfile)
   - Run `npm test` and `npm run lint`
   - *Depends on*: Step 1

3. **Remove frontend dead deps** — `frontend/package.json`
   - Remove `axios`, `vue-i18n`, `@heroicons/vue` from `dependencies`
   - Run `npm install` (regenerates lockfile)
   - Run `npm test -- --run` and `npm run lint` and `npm run build`
   - *Depends on*: Step 1

4. **Delete root dead files** — `Dockerfile`, `nginx.conf`, `package-lock.json`
   - Verify each is truly unused (no references in `docker-compose.yml`, CI, or docs)
   - Delete each file
   - *Depends on*: nothing

5. **Remove dead config** — `docker-compose.override.yml`
   - Remove `INTEGRATION_TESTS=1` from api environment
   - *Depends on*: nothing

6. **Archive completed planning docs** — `planning/`
   - Create `planning/archived/`
   - Move all completed bp-* suites (Status: completed or Date completed populated)
   - Move `ARCHITECT/` → `planning/archived/ARCHITECT/`
   - Keep template files in `planning/` root
   - Keep in-progress/planned bp-* suites
   - *Depends on*: nothing

7. **Fix `.gitignore`** — `.gitignore`
   - Change `package-lock.json` → `/package-lock.json`
   - Verify backend/frontend lockfiles are now tracked with `git add --dry-run backend/package-lock.json`
   - *Depends on*: nothing

8. **Final verification** — `docker compose up --build`
   - Smoke test: services start correctly
   - Run full test suite: `npm test` (backend) + `npm test -- --run` (frontend)
   - *Depends on*: Steps 2-7

---

### c) Per-File Action Plan

#### `backend/package.json` (MODIFY)
- **Remove from `dependencies`**:
  ```diff
  - "axios": "^1.6.2",
  - "slugify": "^1.6.6",
  ```
- **Run**: `cd backend && npm install`

#### `frontend/package.json` (MODIFY)
- **Remove from `dependencies`**:
  ```diff
  - "axios": "^1.6.2",
  - "vue-i18n": "^9.7.0",
  - "@heroicons/vue": "^2.1.1",
  ```
- **Run**: `cd frontend && npm install`

#### `Dockerfile` (root) (DELETE)
- **Verify unused**: `grep -r "Dockerfile" docker-compose.yml .github/workflows/` — only `backend/Dockerfile` and `frontend/Dockerfile` referenced
- **Delete**: `rm Dockerfile`

#### `nginx.conf` (root) (DELETE)
- **Verify unused**: Only frontend nginx config is `frontend/nginx.conf` (used by `frontend/Dockerfile`)
- **Delete**: `rm nginx.conf`

#### `package-lock.json` (root) (DELETE)
- **Delete**: `rm package-lock.json`

#### `docker-compose.override.yml` (MODIFY)
- **Remove**: `INTEGRATION_TESTS=1` line from api.environment

#### `planning/` (MOVE)
- **Create**: `mkdir -p planning/archived`
- **Identify completed**: For each `planning/bp-*/03_ARCHITECT_IMPLEMENTATION.md`, check if Status is `completed` or Date completed is set
- **Move completed**: `mv planning/bp-*/ planning/archived/` (only completed ones)
- **Move ARCHITECT**: `mv ARCHITECT/ planning/archived/ARCHITECT/`

#### `.gitignore` (MODIFY)
- **Change**: `package-lock.json` → `/package-lock.json`
- **Verify**: `git check-ignore backend/package-lock.json` should return nothing (meaning it's NOT ignored)
- **Commit lockfiles**: `git add backend/package-lock.json frontend/package-lock.json`

---

### d) Dependencies

- No new npm dependencies
- No infrastructure changes

---

### e) Risks/Edge Cases

- **[Missing transitive dep]**: If another package depends on `axios` or `slugify` transitively, `npm install` will still install them. The removal is safe because npm handles transitive deps.
- **[Lockfile not regenerated]**: After removing deps, `npm install` must be run to regenerate `package-lock.json`. Verify the lockfile no longer lists the removed packages with `npm ls <pkg>`.
- **[Post-merge lockfile conflicts]**: Removing lockfiles from `.gitignore` will cause merge conflicts on first commit. This is expected and acceptable.

---

### f) Testing

#### Verification Tests
- [ ] `cd backend && npm ls axios` → `(empty)` — not installed
- [ ] `cd backend && npm ls slugify` → `(empty)` — not installed
- [ ] `cd frontend && npm ls axios` → `(empty)` — not installed
- [ ] `cd frontend && npm ls vue-i18n` → `(empty)` — not installed
- [ ] `cd frontend && npm ls @heroicons/vue` → `(empty)` — not installed
- [ ] `docker compose up --build` — services start without root Dockerfile
- [ ] `git check-ignore backend/package-lock.json` → returns nothing
- [ ] `git check-ignore frontend/package-lock.json` → returns nothing
- [ ] `ls planning/archived/` contains moved bp-* and ARCHITECT/ directories

#### Full Suite
- [ ] `cd backend && npm test` — passes
- [ ] `cd backend && npm run lint` — passes
- [ ] `cd frontend && npm test -- --run` — passes
- [ ] `cd frontend && npm run lint` — passes
- [ ] `cd frontend && npm run build` — passes

---

### g) Migration Notes

No database migrations. The `.gitignore` change will cause `backend/package-lock.json` and `frontend/package-lock.json` to be tracked by git for the first time. This may conflict with other branches — coordinate the merge.

---

### h) Files Changed

**Deleted:**
```
Dockerfile                     → DELETE (root, broken/unused)
nginx.conf                     → DELETE (root, only used by deleted Dockerfile)
package-lock.json              → DELETE (root, empty orphan)
```

**Modified:**
```
backend/package.json           → MODIFY (remove axios, slugify)
frontend/package.json          → MODIFY (remove axios, vue-i18n, @heroicons/vue)
docker-compose.override.yml    → MODIFY (remove INTEGRATION_TESTS=1)
.gitignore                     → MODIFY (package-lock.json → /package-lock.json)
```

**Moved/Created:**
```
planning/archived/             → CREATE
planning/archived/bp-*/        → MOVE (completed suites)
planning/archived/ARCHITECT/   → MOVE (from root ARCHITECT/)
```

---

### i) Code Review Checklist

- [ ] All dead deps verified by grep before removal
- [ ] `npm install` run after each package.json change
- [ ] Root Dockerfile confirmed unused by compose and CI
- [ ] Root nginx.conf confirmed unused (only frontend/nginx.conf referenced)
- [ ] Root package-lock.json confirmed empty orphan
- [ ] `INTEGRATION_TESTS=1` confirmed unread by any code
- [ ] Completed planning suites correctly identified (not accidentally archiving active ones)
- [ ] `.gitignore` change doesn't break anything — verified with `git check-ignore`
- [ ] `docker compose up --build` succeeds

---

### j) Post-Deploy Verification

1. [ ] Backend `npm test` passes
2. [ ] Frontend `npm test -- --run` passes
3. [ ] Frontend `npm run build` succeeds
4. [ ] `docker compose up --build` starts all services
5. [ ] Planning suite is clean: archived items in `planning/archived/`, templates remain in `planning/`
6. [ ] `grep -r "INTEGRATION_TESTS=1" docker-compose.override.yml` returns nothing
7. [ ] `grep -r "from 'axios'" frontend/src/ frontend/cypress/` returns nothing (confirming no hidden usage)
8. [ ] `npm ls axios --depth=0` in both packages returns `(empty)`
