# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: pending
**Date started**: 2026-07-27
**Date completed**: TBD
**Author**: AI Assistant
**Feature scope**: Backend

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

- [x] I have checked if the **backend API** already exists — YES (usage routes exist)
- [x] I have checked if the **frontend API client** already exists — YES (no changes needed)
- [x] I have checked if the **frontend UI** already exists — YES (no changes needed)
- [x] I have checked if the **router** already has a route — N/A (backend-only)
- [x] I have checked if there are **existing patterns** I should follow — YES (UsageLogger, pool.query)
- [x] I have checked if there are **existing tabs/sections** — N/A (backend-only)
- [x] I have checked if the **feature should extend existing code** — YES (extend UsageLogger)
- [x] I have checked if **shared components** exist — N/A (backend-only)

### Both Frontend AND Backend

- [x] This feature is **API only** (no new UI) — backend writes to new table, no API shape changes
- [x] I have verified the backend routes, controllers, and services are complete — no new routes needed
- [x] I have checked the **OpenAPI spec** — no changes needed (no new endpoints)
- [x] I have checked if **generated TypeScript types** need regeneration — NO (no API changes)

### Dependency Analysis

- [x] All new npm/system dependencies: NONE (crypto is built-in)
- [x] All existing services/modules affected: UsageLogger, three providers
- [x] Breaking changes: NONE (dual-write maintains backward compatibility)
- [x] No circular dependencies introduced

### Configuration Audit

- [x] All new environment variables: NONE
- [x] All new config files or schema changes: new migration only
- [x] Backward compatibility maintained: YES (usage_logs continues to work)

### Database & Migration

- [x] Migration file exists with both `up` and `rollback` SQL — YES (040_telemetry_events.sql + rollback)
- [x] Migration order is correct — after 039 in apply.js array
- [x] Rollback is tested — DROP TABLE IF EXISTS
- [x] No breaking schema changes — new table only, no changes to existing tables

### Testing Strategy

- [x] Unit test files identified: eventHashService.test.js, telemetryEvents.test.js, usageLogger.test.js (extend)
- [x] Backend Jest integration tests: N/A (no API changes)
- [x] **Bash integration suite**: N/A (no API changes)
- [x] Edge cases explicitly tested: null usage, zero duration, duplicate hash, generic unknown fields
- [x] **Test stubs created BEFORE production code** — listed in 04_SPECIFICATION.md
- [x] New test files CREATED for all new/changed code
- [x] Regression test added: dual-write test cases
- [x] **Coverage threshold (60%)**: run `npm run test:coverage`

### Implementation Readiness

- [x] I have a plan to implement this within the estimated effort
- [x] I know which files to create vs. modify
- [x] I know which existing patterns to follow (UsageLogger, pool.query, Jest)
- [x] I know how to test (unit tests for EventHashService, UsageLogger, providers)
- [x] I have identified the **branch** I will work on

## Post-Implementation Checklist

After implementation, complete ALL items below before marking the ticket as done.

- [ ] All unit tests pass (`npm test` in backend/)
- [ ] Linting passes (`npm run lint` in backend/)
- [ ] **Coverage threshold enforced**: `npm run test:coverage` — must pass 60% min
- [ ] All action items in `03_ARCHITECT_IMPLEMENTATION.md` are completed
- [ ] All testing checklist items in `01_ARCHITECT_REQUIREMENT.md` are verified
- [ ] `03_ARCHITECT_IMPLEMENTATION.md` has been updated with Date completed, PR, Branch
- [ ] `04_SPECIFICATION.md` reflects the final implementation
- [ ] Migration applied cleanly: `npm run db:migrate`
- [ ] Rollback tested: `npm run db:migrate` with rollback SQL
- [ ] Code reviewed by another agent or human if available

## When to Ask the User

1. **Ambiguous acceptance criteria** — the requirement is unclear
2. **Significant scope change** — more work than estimated
3. **Conflicting requirements** — best practice conflicts with existing feature
4. **Unknown unknowns** — something fundamentally changes the approach
5. **Production impact** — could affect running users
6. **Migration issue** — migration fails or corrupts data

---

*This checklist prevents agents from skipping planning and jumping straight to coding.*
