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
- [x] I have read `04_SPECIFICATION.md` — I know the exact file operations, signatures, and test expectations
- [x] I have identified all assumptions and confirmed they are reasonable
- [x] I know what is IN scope and OUT of scope
- [ ] I have verified there are no important design decisions that require user input (see "Important Design Decisions" in 01_ARCHITECT_REQUIREMENT.md)

### Existing Infrastructure Audit

- [x] I have checked if the **backend API** already exists — YES for delete/revoke, NO for update
- [x] I have checked if the **frontend API client** already exists — NO for delete/revoke — must add
- [x] I have checked if the **frontend UI component/screen** already exists — PARTIAL (AgentDetail.vue exists but no action buttons)
- [x] I have checked if the **router** already has a route for this feature — YES
- [x] I have checked if there are **existing patterns** I should follow — YES, confirm dialogs, danger buttons
- [x] I have checked if the **feature should extend existing code** rather than creating new files — YES, extend AgentDetail.vue and AgentList.vue
- [x] I have checked if **shared components** exist that I should reuse — NO existing confirm dialog component

### Both Frontend AND Backend

- [x] Backend API exists for delete (DELETE /agents/:id) and revoke (POST /agents/revoke/:id)
- [x] Backend API does NOT exist for update — update agent name is OUT of scope
- [x] Frontend API client needs new functions: `deleteAgent`, `revokeAgentKey`
- [x] Frontend UI needs: action buttons on AgentDetail, CRUD agents table on AgentList
- [x] No new npm dependencies needed
- [x] No new environment variables needed
- [x] No database migrations needed

### Testing Strategy

- [ ] Unit tests: `frontend/src/__tests__/agents.test.js` — extend with deleteAgent, revokeAgentKey tests
- [ ] Component tests: `frontend/cypress/component/AgentDetail.cy.ts` — action buttons, confirm dialogs
- [ ] Loading, error, and confirmation states tested
- [ ] Code coverage: no significant decrease in changed modules

### Implementation Readiness

- [ ] I have a plan to implement this within the estimated effort
- [ ] I know which files to create vs. modify
- [ ] I know which existing patterns to follow (naming, structure, error handling)
- [ ] I know how to test (unit, component)
- [ ] I have identified the **branch** I will work on

## Post-Implementation Checklist

- [ ] All unit tests pass (`npm test` in frontend)
- [ ] Linting passes (`npm run lint` in frontend)
- [ ] Frontend typecheck passes (`npm run typecheck`)
- [ ] Frontend build passes (`npm run build`)
- [ ] `03_ARCHITECT_IMPLEMENTATION.md` has been updated with Date completed, PR, Branch
- [ ] `04_SPECIFICATION.md` reflects the final implementation
- [ ] Code reviewed by human if available
- [ ] Post-deploy verification: visit /agents/:id, test revoke/delete buttons

## When to Ask the User

1. **AgentList dual-table layout**: Should CRUD agents table replace heartbeat table, or be in a tab alongside it? → **Decision**: Tab alongside (heartbeat tab + CRUD tab)
2. **Edit agent name**: No backend API exists. Out of scope for this ticket.

---

*This checklist prevents agents from skipping planning and jumping straight to coding.*
