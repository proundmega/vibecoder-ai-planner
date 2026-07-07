# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: pending
**Date started**: 2026-07-07
**Date completed**: {{DATE}}
**Author**: AI Assistant
**Feature scope**: Frontend

---

## Pre-Implementation Checklist

### Planning

- [x] I have read `01_ARCHITECT_REQUIREMENT.md` — I understand the requirement, scope, and acceptance criteria
- [x] I have read `02_ARCHITECT_DESIGN.md` — I understand the design, alternatives considered, and risks
- [x] I have read `03_ARCHITECT_IMPLEMENTATION.md` — I know the actions, dependencies, and testing steps
- [ ] I have read `04_SPECIFICATION.md` (if it exists) — I know the exact file operations, signatures, and test expectations
- [x] I have identified all assumptions and confirmed they are reasonable
- [x] I know what is IN scope and OUT of scope
- [ ] I have verified there are no important design decisions that require user input (see "Important Design Decisions" in 01_ARCHITECT_REQUIREMENT.md)

### Existing Infrastructure Audit

- [x] I have checked if the **backend API** already exists — YES, fully implemented (POST /agents/create, GET /agents/, DELETE /agents/:id, POST /agents/revoke/:id)
- [x] I have checked if the **frontend API client** already exists — YES, `createAgent()` exists in `frontend/src/api/agents.js` but is never called
- [x] I have checked if the **frontend UI component/screen** already exists — PARTIAL. `AgentList.vue` exists but has no create button/modal. `AgentDetail.vue` exists but has no delete/revoke.
- [x] I have checked if the **router** already has a route for this feature — YES, `/agents` and `/agents/:id` routes exist
- [x] I have checked if there are **existing patterns** I should follow — YES, `UserModal.vue` for modal pattern, `TicketEditModal.vue` for form pattern
- [x] I have checked if there are **existing tabs/sections** where this feature could be added — N/A (standalone page)
- [ ] I have checked if the **feature should extend existing code** rather than creating new files — YES, extend AgentList.vue with modal, create new AgentModal.vue component
- [x] I have checked if **shared components** exist that I should reuse — YES, `UserModal.vue` pattern for modal structure

### Both Frontend AND Backend

- [x] Backend API already exists — no backend changes needed (except optional API key masking)
- [x] Frontend UI needs: Create Agent button, AgentModal component, success feedback
- [x] Frontend API client already exists — `createAgent()` in `frontend/src/api/agents.js`
- [x] No new npm dependencies needed
- [x] No new environment variables needed
- [x] No database migrations needed

### Testing Strategy

- [ ] Unit tests: `frontend/src/__tests__/agents.test.js` — extend with createAgent + AgentModal tests
- [ ] Component tests: `frontend/cypress/component/` — AgentModal component tests
- [ ] E2E tests: `frontend/cypress/e2e/` — create agent user flow
- [ ] Loading, error, and empty states tested
- [ ] Code coverage: no significant decrease in changed modules

### Implementation Readiness

- [ ] I have a plan to implement this within the estimated effort
- [ ] I know which files to create vs. modify
- [ ] I know which existing patterns to follow (naming, structure, error handling)
- [ ] I know how to test (unit, component, E2E)
- [ ] I have identified the **branch** I will work on

## Post-Implementation Checklist

- [ ] All unit tests pass (`npm test` in frontend)
- [ ] Linting passes (`npm run lint` in frontend)
- [ ] Frontend typecheck passes (`npm run typecheck`)
- [ ] Frontend build passes (`npm run build`)
- [ ] `03_ARCHITECT_IMPLEMENTATION.md` has been updated with Date completed, PR, Branch
- [ ] `04_SPECIFICATION.md` (if created) reflects the final implementation
- [ ] Code reviewed by human if available
- [ ] Post-deploy verification: visit /agents, click "Create Agent", fill form, verify agent appears in list

## When to Ask the User

1. **UI placement decision** — AgentList currently shows heartbeat data; should it also show CRUD agents? Or replace heartbeat data?
2. **Scope decision** — Should AgentDetail also get delete/revoke buttons (out of scope for this ticket)?
3. **API key masking** — Should we mask API keys in the list response (backend change)?

---

*This checklist prevents agents from skipping planning and jumping straight to coding.*
