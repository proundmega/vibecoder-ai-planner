# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: pending
**Date started**: {{DATE}}
**Date completed**: {{DATE}}
**Author**: AI Assistant
**Feature scope**: Backend

---

## Pre-Implementation Checklist

### Planning

- [ ] I have read `01_ARCHITECT_REQUIREMENT.md` — I understand the requirement, scope, and acceptance criteria
- [ ] I have read `02_ARCHITECT_DESIGN.md` — I understand the design, alternatives considered, and risks
- [ ] I have read `03_ARCHITECT_IMPLEMENTATION.md` — I know the actions, dependencies, and testing steps
- [ ] I have read `04_SPECIFICATION.md` (if it exists) — I know the exact file operations, signatures, and test expectations
- [ ] I have identified all assumptions and confirmed they are reasonable
- [ ] I know what is IN scope and OUT of scope
- [ ] I have verified there are no important design decisions that require user input (see "Important Design Decisions" in 01_ARCHITECT_REQUIREMENT.md)

### Existing Infrastructure Audit

- [ ] I have verified which middleware/services use in-memory Maps for state (`middleware/auth.js:11`, `middleware/auth.js:186`, `services/PermissionService.js`)
- [ ] I have checked if Redis is already a dependency (no — `redis` or `ioredis` must be added)
- [ ] I have checked all callers of rate-limiter factory to understand route coverage
- [ ] I have checked how PermissionService caches permissions and which DB queries it caches
- [ ] I have checked the GracefulShutdown hook chain to add Redis disconnection

### Both Frontend AND Backend

- [ ] If this feature has a **backend API**, I have verified the API route, controller, and service exist or will be created
- [ ] If this feature has a **frontend UI**, I have identified where it will live (which view, which tab, which modal)
- [ ] If this feature is **API only** (no new UI), I have verified the backend routes, controllers, and services are complete
- [ ] I have checked the **env vars** needed and verified they are documented in `.env.example`

### Dependency Analysis

- [ ] All new npm/system dependencies are listed with versions and purpose
- [ ] All existing services/modules that will be affected are identified
- [ ] Breaking changes are noted (API contract changes, DB migration, config format)
- [ ] No circular dependencies introduced

### Configuration Audit

- [ ] All new environment variables are documented with defaults (REDIS_URL, REDIS_PREFIX, RATE_LIMIT_*)
- [ ] All new config files or schema changes are documented
- [ ] Backward compatibility maintained — old in-memory behavior should be kept as fallback

### Testing Strategy

- [ ] Unit test files identified per changed module (auth middleware, PermissionService, rate-limiter factory)
- [ ] Integration test scenarios defined (rate limit across requests, lockout across multiple attempts, permission cache invalidation)
- [ ] Edge cases explicitly tested (Redis unavailable fallback, concurrent requests, cache expiry)
- [ ] Regression test added for any bug fix (reproduces the original failure condition)

### Implementation Readiness

- [ ] I have a plan to implement this within the estimated effort
- [ ] I know which files to create vs. modify
- [ ] I know which existing patterns to follow (naming, structure, error handling)
- [ ] I know how to test (unit, integration)
- [ ] I have identified the **branch** I will work on

## Post-Implementation Checklist

- [ ] All unit tests pass (`npm test` in backend)
- [ ] All integration tests pass (`npm run test:integration` if applicable)
- [ ] Linting passes (`npm run lint`)
- [ ] All action items in `03_ARCHITECT_IMPLEMENTATION.md` are completed
- [ ] All testing checklist items in `01_ARCHITECT_REQUIREMENT.md` are verified
- [ ] `03_ARCHITECT_IMPLEMENTATION.md` has been updated with Date completed, PR, Branch
- [ ] `04_SPECIFICATION.md` (if created) reflects the final implementation
- [ ] New env vars added to `backend/.env.example`
- [ ] Docker Compose updated with Redis service if needed
