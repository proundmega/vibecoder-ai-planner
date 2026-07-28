# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: pending
**Date started**: 2026-07-28
**Date completed**: TBD
**Author**: AI Assistant
**Feature scope**: Backend (CI infrastructure)

---

## Pre-Implementation Checklist

Before starting any implementation, complete ALL items below. Do NOT skip any step.

### Planning

- [x] I have read `01_ARCHITECT_REQUIREMENT.md` — I understand the requirement, scope, and acceptance criteria
- [x] I have read `02_ARCHITECT_DESIGN.md` — I understand the design, alternatives considered, and risks
- [x] I have read `03_ARCHITECT_IMPLEMENTATION.md` — I know the actions, dependencies, and testing steps
- [x] I have read `04_SPECIFICATION.md` — I know the exact file operations, signatures, and test expectations
- [x] I have identified all assumptions and confirmed they are reasonable
- [x] I know what is IN scope and OUT of scope
- [x] I have verified there are no important design decisions that require user input

### Existing Infrastructure Audit

- [x] I have checked if the **backend API** already exists — N/A (CI infrastructure change)
- [x] I have checked if the **frontend API client** already exists — N/A
- [x] I have checked if the **frontend UI** already exists — N/A
- [x] I have checked if the **router** already has a route — N/A
- [x] I have checked if there are **existing patterns** I should follow — Docker Compose naming conventions
- [x] I have checked if there are **existing tabs/sections** — N/A
- [x] I have checked if the **feature should extend existing code** — YES (helpers.sh docker_exec)
- [x] I have checked if **shared components** exist — N/A

### Both Frontend AND Backend

- [x] This is a **CI infrastructure** change — no API or UI changes
- [x] I have verified the backend routes, controllers, and services are complete — no backend code changes
- [x] I have checked the **OpenAPI spec** — no changes needed
- [x] I have checked if **generated TypeScript types** need regeneration — NO

### Dependency Analysis

- [x] All new npm/system dependencies: NONE
- [x] All existing services/modules affected: docker-compose*.yml, Jenkinsfile, helpers.sh
- [x] Breaking changes: None (local dev unaffected)
- [x] No circular dependencies introduced

### Configuration Audit

- [x] All new environment variables: `COMPOSE_PROJECT_NAME` (set in Jenkinsfile)
- [x] All new config files or schema changes: None
- [x] Backward compatibility maintained: YES (local dev uses directory name as project)

### Database & Migration

- [x] No database changes needed

### Testing Strategy

- [x] Unit test files identified: N/A (no code changes)
- [x] Bash integration suite: verify tests pass with dynamic project name
- [x] Edge cases: concurrent builds on same agent, port collisions

### Implementation Readiness

- [x] I have a plan to implement this within the estimated effort
- [x] I know which files to create vs. modify
- [x] I know which existing patterns to follow
- [x] I know how to test
- [x] I have identified the **branch** I will work on

## Post-Implementation Checklist

After implementation, complete ALL items below before marking the ticket as done.

- [ ] Local dev: `docker compose up --build` still works with default project name
- [ ] Jenkins: two concurrent builds on same agent don't collide
- [ ] Integration tests: all bash tests pass with dynamic project name
- [ ] No backend/frontend code changes — verify all existing tests pass
- [ ] `03_ARCHITECT_IMPLEMENTATION.md` has been updated with Date completed, PR, Branch

---

*This checklist prevents agents from skipping planning and jumping straight to coding.*
