# 02_ARCHITECT_DESIGN.md — Dead Code and Stale File Cleanup

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Both
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

The repository has accumulated dead code, unused dependencies, broken files, and stale documentation. These items increase cognitive load, waste CI time (unnecessary dependency installs), and mislead new developers/agents about what's currently relevant.

---

## Current State

### Dead Dependencies

| Package | Location | Status | Impact |
|---------|----------|--------|--------|
| `axios` ^1.6.2 | `backend/package.json` | Never imported | Bloat, security surface |
| `slugify` ^1.6.6 | `backend/package.json` | Never imported | Bloat, security surface |
| `axios` ^1.6.2 | `frontend/package.json` | Never imported; code uses native fetch | Redundant bundle size |
| `vue-i18n` ^9.7.0 | `frontend/package.json` | Never imported | Redundant bundle size |
| `@heroicons/vue` ^2.1.1 | `frontend/package.json` | Likely unused (code uses emoji) | Redundant bundle size |

### Dead Files

| File | Problem |
|------|---------|
| `Dockerfile` (root) | No `package.json` exists at root → `npm ci` fails; `npm run build` has no config; not referenced by compose |
| `nginx.conf` (root) | Only used by root Dockerfile (above); frontend has its own `nginx.conf` in `frontend/` |
| `package-lock.json` (root) | `{"packages": {}}` with no matching `package.json` |
| `.env` (root) | Contains weak default secrets (JWT_SECRET, ENCRYPTION_KEY) — should not be checked in at all (currently gitignored but present in working tree) |

### Dead Config

| Config | Location | Problem |
|--------|----------|---------|
| `INTEGRATION_TESTS=1` | `docker-compose.override.yml` | No code reads this env var |

### Stale Documentation

| Location | Problem |
|----------|---------|
| `planning/bp-01` through `bp-52` | Many are completed tickets; mixed with in-progress ones; hard to tell what's current |
| `ARCHITECT/` | Lives outside `planning/`; duplicates the structure |

### Broken `.gitignore`

| Pattern | Problem |
|---------|---------|
| `package-lock.json` | Matches ALL `package-lock.json` files in any subdirectory; should be `/package-lock.json` to only ignore root |

---

## Design

### Option A: Incremental Cleanup (Recommended)

Process each category independently. Each is safe and reversible.

#### Step 1: Remove Dead Dependencies

For each unused dependency:
1. Remove from `package.json`
2. Verify `npm install` still works
3. Verify `npm test` and `npm run build` still work
4. If the dep is used only in tests or config files outside `src/`, flag it for discussion

Checklist for each removal:
- `grep -r "require('axios')" backend/src/`
- `grep -r "from 'axios'" frontend/src/`
- `grep -r "require('slugify')" backend/src/`
- `grep -r "from 'vue-i18n'" frontend/src/ frontend/cypress/`
- `grep -r "from '@heroicons/vue'" frontend/src/ frontend/cypress/`

If any reference is found in test files or support files, keep the dependency. Otherwise, remove.

#### Step 2: Remove Dead Files

- `Dockerfile` (root) — delete; `docker-compose.yml` uses `./backend/Dockerfile` and `./frontend/Dockerfile`
- `nginx.conf` (root) — delete; `frontend/nginx.conf` is the active one
- `package-lock.json` (root) — delete
- `.env` (root) — keep but ensure it stays in `.gitignore`; it's useful for local development template

#### Step 3: Remove Dead Config

- `docker-compose.override.yml`: Remove `INTEGRATION_TESTS=1` line

#### Step 4: Archive Stale Planning

Create `planning/archived/` and move all completed bp-* suites there. Completed suites are identified by:
- Has `03_ARCHITECT_IMPLEMENTATION.md` with `Status: completed` or `Date completed` filled in
- Is referenced by a closed/merged PR
- Older than 30 days without activity

Do NOT archive:
- `planning/00_ARCHITECT_CHECKLIST.md` through `04_SPECIFICATION.md` — these are templates
- `planning/TICKETS.txt` — "Tickets" → "tickets.txt" at root; keep both for now
- Active bp-* suites (those with `Status: in_progress` or `planned`)

Also move `ARCHITECT/` → `planning/archived/ARCHITECT/`.

#### Step 5: Fix `.gitignore`

Change `package-lock.json` → `/package-lock.json` so that `backend/package-lock.json` and `frontend/package-lock.json` are tracked.

### Option B: Full Purge

Delete everything that's not referenced. Riskier — might remove something that has value. Not recommended without thorough audit.

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/package.json` | MODIFY | Remove `"axios": "^1.6.2"`, `"slugify": "^1.6.6"` from `dependencies` |
| `frontend/package.json` | MODIFY | Remove `"axios": "^1.6.2"`, `"vue-i18n": "^9.7.0"`, `"@heroicons/vue": "^2.1.1"` from `dependencies` |
| `Dockerfile` (root) | DELETE | Entire file |
| `nginx.conf` (root) | DELETE | Entire file |
| `package-lock.json` (root) | DELETE | Entire file |
| `docker-compose.override.yml` | MODIFY | Remove line 7: `- INTEGRATION_TESTS=1` |
| `.gitignore` | MODIFY | Change `package-lock.json` → `/package-lock.json` |
| `planning/archived/` | CREATE | New directory |
| `planning/bp-*` (completed) | MOVE | Move to `planning/archived/` |
| `ARCHITECT/` | MOVE | Move to `planning/archived/ARCHITECT/` |

---

## Risks and Edge Cases

- **[Hidden import]**: A dependency might be imported dynamically (e.g., `require('axios')` inside a try/catch). The grep search should also check for dynamic requires.
- **[Transitive dependency]**: Another package might depend on one of the removed packages. `npm ls <pkg>` will confirm if it's a transitive dependency or a direct one.
- **[Cypress plugins]**: Cypress support files might use these dependencies. Check `frontend/cypress/` separately.

---

## Alternative Designs Considered

### Alternative 1: Leave everything alone
- **Pros**: No risk of breaking anything
- **Cons**: Repository stays cluttered; dependencies remain as attack surface; agents get confused by stale files
- **Decision**: Cleanup has no functional risk if done incrementally with verification at each step.

### Alternative 2: Deduplicate into monorepo tools (lerna, nx, turborepo)
- **Pros**: Proper monorepo management
- **Cons**: Significant tooling investment; out of scope for a cleanup ticket
- **Decision**: Defer to future architectural decision.
