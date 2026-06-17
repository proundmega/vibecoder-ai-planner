# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: pending
**Date started**: {{DATE}}
**Date completed**: {{DATE}}
**Author**: AI Assistant

---

## Pre-Implementation Checklist

Before starting any implementation, complete ALL items below. Do NOT skip any step.

- [ ] I have read `01_ARCHITECT_REQUIREMENT.md` — I understand the requirement, scope, and acceptance criteria
- [ ] I have read `02_ARCHITECT_DESIGN.md` — I understand the design, alternatives considered, and risks
- [ ] I have read `03_ARCHITECT_IMPLEMENTATION.md` — I know the actions, dependencies, and testing steps
- [ ] I have identified all assumptions and confirmed they are reasonable
- [ ] I know what is IN scope and OUT of scope
- [ ] I have verified there are no important design decisions that require user input (see "Important Design Decisions" in 01_ARCHITECT_REQUIREMENT.md)
- [ ] I have reviewed the current codebase to understand the existing state
- [ ] I have a plan to implement this within the estimated effort

## Post-Implementation Checklist

After implementation, complete ALL items below before marking the ticket as done.

- [ ] All unit tests pass (`npm test` in relevant directory)
- [ ] All integration tests pass (`npm run test:integration` if applicable)
- [ ] Linting passes (`npm run lint` in relevant directory)
- [ ] All action items in `03_ARCHITECT_IMPLEMENTATION.md` are completed
- [ ] All testing checklist items in `01_ARCHITECT_REQUIREMENT.md` are verified
- [ ] `03_ARCHITECT_IMPLEMENTATION.md` has been updated with:
  - `Date completed` — when implementation finishes
  - `PR` — PR URL after merge
  - `Branch` — git branch used
- [ ] `AGENTS.md` "Best Practices & Planning Templates" table updated with status prefix:
  - `✅` for completed practices
  - `🔄` for in-progress practices
- [ ] Known Constraints in `AGENTS.md` updated if the change affects any constraints
- [ ] New env vars added to `backend/.env.example` if applicable
- [ ] Generated files (OpenAPI types, etc.) regenerated if applicable
- [ ] Code reviewed by another agent or human if available
- [ ] Post-deploy verification steps completed (see `03_ARCHITECT_IMPLEMENTATION.md`)

## When to Ask the User

**IMPORTANT**: If you encounter any of the following, STOP and ask the user before proceeding:

1. **Ambiguous acceptance criteria** — the requirement is unclear or has multiple valid interpretations
2. **Significant scope change** — the implementation requires more work than estimated, or changes affect areas not mentioned in the requirement
3. **Conflicting requirements** — this best practice conflicts with an existing feature or constraint
4. **Unknown unknowns** — you discover something during implementation that fundamentally changes the approach
5. **Production impact** — the change could affect running users (data migration, API breaking change, etc.)

Do NOT guess. Do NOT assume. Ask the user.

---

*This checklist prevents agents from skipping planning and jumping straight to coding.*
