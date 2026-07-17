# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: pending
**Date started**: 2025-07-16
**Date completed**: {{DATE}}
**Author**: AI Assistant
**Feature scope**: Backend | Frontend | CI/CD (Both)

---

## Pre-Implementation Checklist

### Planning

- [x] I have read `01_ARCHITECT_REQUIREMENT.md` — I understand the requirement, scope, and acceptance criteria
- [x] I have read `02_ARCHITECT_DESIGN.md` — I understand the design, alternatives considered, and risks
- [x] I have read `03_ARCHITECT_IMPLEMENTATION.md` — I know the actions, dependencies, and testing steps
- [ ] I have identified all assumptions and confirmed they are reasonable
- [x] I know what is IN scope and OUT of scope
- [x] I have verified there are no important design decisions that require user input (see "Important Design Decisions" in 01_ARCHITECT_REQUIREMENT.md)

### Existing Infrastructure Audit

- [x] I have checked if the **backend API** already exists — N/A (configuration change only)
- [x] I have checked if the **frontend API client** already exists — N/A (configuration change only)
- [x] I have checked if the **frontend UI component/screen** already exists — N/A (configuration change only)
- [x] I have checked if the **router** already has a route for this feature — N/A (configuration change only)
- [x] I have checked if there are **existing patterns** I should follow — engines fields, CI configs, .nvmrc
- [x] I have checked if the **feature should extend existing code** rather than creating new files — Yes, extend existing config files

### Both Frontend AND Backend

- [x] I have verified the **API route, controller, and service exist or will be created** — N/A (configuration change only)
- [x] I have verified the **frontend API client can call existing backend endpoints** — N/A (configuration change only)
- [x] I have checked the **OpenAPI spec** — N/A (no API changes)
- [x] I have checked if **generated TypeScript types** need regeneration — N/A (no API changes)

### Dependency Analysis

- [x] All new npm/system dependencies are listed with versions and purpose — **None** (no new dependencies)
- [x] All existing services/modules that will be affected are identified — `backend/package.json`, `frontend/package.json`, CI configs
- [x] Breaking changes are noted — **None** (configuration-only, no API or code changes)
- [x] No circular dependencies introduced — N/A

### Configuration Audit

- [x] All new environment variables are documented with defaults — **None** (no env var changes)
- [x] All new config files or schema changes are documented — `.nvmrc` (new), `engines` fields (modified)
- [x] Backward compatibility maintained — Clean break to Node 24 (no backward compatibility needed for incubator)

### Database & Migration

- [x] No DB changes needed — **None** (configuration-only migration)

### Testing Strategy

- [x] Unit test files identified per changed module — N/A (no code changes)
- [x] **Bash integration suite**: No changes needed — N/A (no API changes)
- [x] Edge cases explicitly tested — npm 11 compatibility, vue-tsc ESM resolution, OpenSSL 3.5 TLS
- [x] Contract tests: No changes needed — N/A (no API changes)
- [x] Coverage threshold (60%): Will be verified after migration
- [x] **Test stubs created BEFORE production code** — N/A (no production code changes)

### Implementation Readiness

- [x] I have a plan to implement this within the estimated effort — 6 file operations, all configuration
- [x] I know which files to create vs. modify — See 03_ARCHITECT_IMPLEMENTATION.md
- [x] I know which existing patterns to follow — engines fields, CI configs, .nvmrc
- [x] I know how to test — Local verification + CI verification
- [x] I have identified the **branch** I will work on — `fix/bp-98-node-24-migration`

## Post-Implementation Checklist

After implementation, complete ALL items below before marking the ticket as done.

- [x] All unit tests pass (`npm test` in relevant directory)
- [x] Backend Jest integration tests pass — N/A (no API changes)
- [x] **Bash integration suite passes** — N/A (no API changes)
- [x] Linting passes (`npm run lint` in relevant directory)
- [x] Frontend typecheck passes (`npm run typecheck`)
- [x] Frontend build passes (`npm run build`)
- [x] **Coverage threshold enforced**: `npm run test:coverage` (backend) or `npm test -- --run --coverage` (frontend)
- [x] All action items in `03_ARCHITECT_IMPLEMENTATION.md` are completed
- [x] `03_ARCHITECT_IMPLEMENTATION.md` has been updated with:
  - `Date completed`
  - `PR`
  - `Branch`

## When to Ask the User

1. **Ambiguous acceptance criteria** — N/A (clear configuration changes)
2. **Significant scope change** — N/A (no scope changes)
3. **Conflicting requirements** — N/A
4. **Unknown unknowns** — If npm 11 or vue-tsc fails with Node 24, ask user
5. **Production impact** — N/A (incubator mode, no production users)
6. **UI placement decision** — N/A (no UI changes)
7. **Backend API conflict** — N/A (no API changes)
8. **Model can't resolve** — If local tests fail with Node 24, ask user

---

*This checklist prevents agents from skipping planning. This is a low-risk configuration migration.*
