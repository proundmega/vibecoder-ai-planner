# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: pending
**Date started**: 2026-06-29
**Date completed**: 
**Author**: AI Assistant
**Feature scope**: Backend

---

## Pre-Implementation Checklist

Before starting any implementation, complete ALL items below. Do NOT skip any step.

### Planning

- [ ] I have read `01_ARCHITECT_REQUIREMENT.md` — I understand the requirement, scope, and acceptance criteria
- [ ] I have read `02_ARCHITECT_DESIGN.md` — I understand the design, alternatives considered, and risks
- [ ] I have read `03_ARCHITECT_IMPLEMENTATION.md` — I know the actions, dependencies, and testing steps
- [ ] I have identified all assumptions and confirmed they are reasonable
- [ ] I know what is IN scope and OUT of scope
- [ ] I have verified there are no important design decisions that require user input (see "Important Design Decisions" in 01_ARCHITECT_REQUIREMENT.md)

### Existing Infrastructure Audit

- [ ] I have checked if the **backend API** already exists (routes, controllers, services)
- [ ] I have checked if the **frontend API client** already exists (`frontend/src/api/`)
- [ ] I have checked if the **frontend UI component/screen** already exists (`frontend/src/views/`, `frontend/src/components/`)
- [ ] I have checked if the **router** already has a route for this feature (`frontend/src/router/index.ts`)
- [ ] I have checked if there are **existing patterns** I should follow (same API client style, same component structure, same naming conventions)
- [ ] I have checked if there are **existing tabs/sections** where this feature could be added (e.g., ProjectDetail tabs, navigation menus)
- [ ] I have checked if the **feature should extend existing code** rather than creating new files (e.g., add a tab to ProjectDetail vs. create a new page)
- [ ] I have checked if **shared components** exist that I should reuse (e.g., modals, tables, cards)

### Both Frontend AND Backend

- [ ] If this feature has a **backend API**, I have verified the API route, controller, and service exist or will be created
- [ ] If this feature has a **frontend UI**, I have identified where it will live (which view, which tab, which modal)
- [ ] If this feature is **UI only** (no new API), I have verified the existing API clients cover the needed endpoints
- [ ] If this feature is **API only** (no new UI), I have verified the backend routes, controllers, and services are complete
- [ ] If this feature affects **both**, I have planned the frontend-backend integration (API client → UI component)

### Implementation Readiness

- [ ] I have a plan to implement this within the estimated effort
- [ ] I know which files to create vs. modify
- [ ] I know which existing patterns to follow (naming, structure, error handling)
- [ ] I know how to test (unit, integration, frontend, E2E)
- [ ] I have identified the **branch** I will work on

## Post-Implementation Checklist

After implementation, complete ALL items below before marking the ticket as done.

- [ ] All unit tests pass (`npm test`)
- [ ] Linting passes (`npm run lint`)
- [ ] All action items in `03_ARCHITECT_IMPLEMENTATION.md` are completed
- [ ] All testing checklist items in `01_ARCHITECT_REQUIREMENT.md` are verified

## When to Ask the User

**IMPORTANT**: If you encounter any of the following, STOP and ask the user before proceeding:

1. **Ambiguous acceptance criteria** — the requirement is unclear or has multiple valid interpretations
2. **Significant scope change** — the implementation requires more work than estimated
3. **Backend API conflict** — the backend API doesn't exist and creating it would conflict with existing patterns

Do NOT guess. Do NOT assume. Ask the user.
