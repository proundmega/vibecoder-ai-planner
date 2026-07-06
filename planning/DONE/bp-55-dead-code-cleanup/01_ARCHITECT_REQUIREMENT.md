# 01_ARCHITECT_REQUIREMENT.md — Dead Code and Stale File Cleanup

**Status**: planned
**Date created**: {{YYYY-MM-DD}}
**Date completed**: {{YYYY-MM-DD}}
**Author**: AI Assistant
**Scope**: Both
**Priority**: P3
**Effort**: Medium

---

## Requirement

Remove dead code, unused dependencies, stale config files, and redundant documentation that clutter the repository and create confusion for developers and agents.

**Problem**: The repository has accumulated several types of dead weight:

1. **Broken/unused Dockerfile** at root — fails to build (missing `package.json`), not referenced by any compose file
2. **Unused npm dependencies** — `axios` in both packages, `slugify` in backend, `vue-i18n` and `@heroicons/vue` in frontend
3. **Dead config** — `INTEGRATION_TESTS=1` env var in `docker-compose.override.yml` that no code reads
4. **Orphaned `package-lock.json`** at root — empty lockfile with no matching `package.json`
5. **Stale planning directories** — completed tickets in `planning/bp-*` should be archived
6. **Duplicated `ARCHITECT/` directory** — lives outside `planning/` with redundant docs

---

## Existing Infrastructure Audit

**CRITICAL**: Before planning, audit what already exists.

### Backend Dependency Check
- [x] `axios` in `backend/package.json` — `grep -r "require('axios')" backend/src/` returns 0 results; `grep -r "import.*axios" backend/src/` returns 0 results
- [x] `slugify` in `backend/package.json` — `grep -r "require('slugify')" backend/src/` returns 0 results

### Frontend Dependency Check
- [x] `axios` in `frontend/package.json` — `grep -r "from 'axios'" frontend/src/` returns 0 results; AGENTS.md explicitly says "do NOT import axios"
- [x] `vue-i18n` in `frontend/package.json` — `grep -r "from 'vue-i18n'" frontend/src/` returns 0 results
- [x] `@heroicons/vue` in `frontend/package.json` — `grep -r "from '@heroicons/vue'" frontend/src/` returns 0 results

### Infrastructure Check
- [x] Root `Dockerfile` — `npm ci` fails because no `package.json` at root; `docker-compose.yml` builds from `./backend/Dockerfile` and `./frontend/Dockerfile`, not root
- [x] `INTEGRATION_TESTS=1` — `grep -r "INTEGRATION_TESTS" backend/src/` returns 0 results (it's in `jest.integration.config.js` line 3 as `process.env.INTEGRATION_TESTS = '1'`, but that's self-assignment, not reading an existing env var)
- [x] Root `package-lock.json` — `{"packages": {}}` with no `package.json`; would cause `npm install` at root to fail

### Documentation Check
- [x] `planning/` — ~76 subdirectories; many are completed tickets (e.g., ba-01-controller-setup, rs-05-user-ui)
- [x] `ARCHITECT/` — outside `planning/`; contains duplicate/redundant docs

### Key Insight
This is a cleanup-only task. No functional changes. Each removal is independently safe and reversible. The order should be: remove dead deps → remove broken files → archive stale planning docs.

---

## Scope

### In Scope
- Remove `axios` from `backend/package.json` and `frontend/package.json`
- Remove `slugify` from `backend/package.json`
- Remove `vue-i18n` and `@heroicons/vue` from `frontend/package.json`
- Delete root `Dockerfile` (broken, unused)
- Delete root `nginx.conf` (only used by the deleted root Dockerfile)
- Delete root `package-lock.json` (empty orphan)
- Remove `INTEGRATION_TESTS=1` from `docker-compose.override.yml` (dead env var)
- Archive completed planning subdirectories into `planning/archived/`
- Move `ARCHITECT/` contents into `planning/` or archive
- Update `.gitignore` to only ignore root `package-lock.json` (not backend/frontend lockfiles)

### Out of Scope
- Removing any actually-used dependency
- Changing any application code behavior
- Database changes
- Code refactoring (only deletion/archival)

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/package.json` | MODIFY | Remove `axios`, `slugify` from dependencies |
| `frontend/package.json` | MODIFY | Remove `axios`, `vue-i18n`, `@heroicons/vue` from dependencies |
| `Dockerfile` (root) | DELETE | Broken, unused multi-stage build |
| `nginx.conf` (root) | DELETE | Only used by deleted root Dockerfile |
| `package-lock.json` (root) | DELETE | Empty orphan |
| `docker-compose.override.yml` | MODIFY | Remove `INTEGRATION_TESTS=1` |
| `.gitignore` | MODIFY | `package-lock.json` → `/package-lock.json` |
| `planning/bp-*` (completed) | MOVE | Archived to `planning/archived/` |
| `ARCHITECT/` | MOVE | Contents moved to `planning/archived/` |
| `planning/archived/` | CREATE | New directory for completed/stale planning docs |
| `database` | NONE | No DB changes |
| `config` | NONE | No env var changes |

---

## Known Unknowns

1. **[Cypress dependency]**: `axios` might be used by Cypress test support files. Check `frontend/cypress/` for `import axios` or `require('axios')`.
2. **[@heroicons/vue usage]**: Some components may use Heroicons indirectly. Check all `.vue` files for icon component imports from `@heroicons/vue`.
3. **[vue-i18n usage]**: Check for `$t()`, `useI18n()`, or `i18n` config in `main.ts` or component files.

---

## Important Design Decisions

1. **Archive vs delete**: Completed planning docs should be archived (not deleted) to preserve history. Old but referenced docs (like `rs-05-user-ui-reference.md`) should be archived with completed bp-* suites.
2. **`.gitignore` change**: Changing `package-lock.json` to `/package-lock.json` means root lockfile is still ignored, but `backend/package-lock.json` and `frontend/package-lock.json` will need to be tracked. Verify they exist and commit them.

---

## Acceptance Criteria

1. [ ] `npm install` in `backend/` succeeds without `axios` or `slugify`
2. [ ] `npm install` in `frontend/` succeeds without `axios`, `vue-i18n`, or `@heroicons/vue`
3. [ ] `docker compose up --build` succeeds without root `Dockerfile` or `nginx.conf`
4. [ ] `npm test` in backend + frontend passes
5. [ ] `npm run build` in frontend passes
6. [ ] `npm run lint` in backend + frontend passes
7. [ ] `planning/archived/` contains all completed bp-* suites + ARCHITECT/ contents
8. [ ] `.gitignore` correctly ignores root `package-lock.json` but tracks backend/frontend lockfiles
9. [ ] No regressions in any functional area

---

## Out of Scope

- Removing actually-used dependencies
- Code refactoring
- Database changes
- Changing any application behavior
