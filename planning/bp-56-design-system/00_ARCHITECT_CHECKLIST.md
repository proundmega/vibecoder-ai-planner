# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: pending
**Date started**: {{DATE}}
**Date completed**: {{DATE}}
**Author**: AI Assistant
**Feature scope**: Frontend

---

## Pre-Implementation Checklist

### Planning

- [ ] I have read `01_ARCHITECT_REQUIREMENT.md` — I understand the requirement, scope, and acceptance criteria
- [ ] I have read `02_ARCHITECT_DESIGN.md` — I understand the design, alternatives considered, and risks
- [ ] I have read `03_ARCHITECT_IMPLEMENTATION.md` — I know the actions, dependencies, and testing steps
- [ ] I have identified all assumptions and confirmed they are reasonable
- [ ] I know what is IN scope and OUT of scope

### Existing Infrastructure Audit

- [ ] I have audited CSS classes used across all `.vue` files in `frontend/src/views/` and `frontend/src/components/`
- [ ] I have identified all repeated patterns (buttons, modals, cards, tables, form inputs, badges)
- [ ] I have checked if any CSS framework is already in use (tailwind, bootstrap, bulma)
- [ ] I have checked the existing `App.vue` for global CSS
- [ ] I have counted the number of unique `.btn-*`, `.modal-*`, `.card-*`, `.table-*`, `.badge-*` CSS classes

### Testing Strategy

- [ ] Visual regression testing approach determined
- [ ] Component rendering tests for shared components
- [ ] Verify no visual regressions after refactor

### Implementation Readiness

- [ ] I have a plan to implement this within the estimated effort
- [ ] I know which files to create vs. modify
- [ ] I know how to test

## Post-Implementation Checklist

- [ ] Frontend tests pass (`npm test -- --run`)
- [ ] Frontend builds (`npm run build`)
- [ ] Linting passes (`npm run lint`)
- [ ] Typecheck passes (`npm run typecheck`)
- [ ] Visual check: all views render identically to before
