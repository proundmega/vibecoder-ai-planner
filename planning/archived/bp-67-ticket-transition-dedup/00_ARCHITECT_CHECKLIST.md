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
- [ ] I have identified all assumptions and confirmed they are reasonable
- [ ] I know what is IN scope and OUT of scope

### Existing Infrastructure Audit

- [ ] I have verified `models/ticket.js` has two `validTransitions` definitions (lines 82 and 138)
- [ ] I have verified both definitions have identical transition rules
- [ ] I have checked if `validTransitions` is referenced anywhere else in the codebase
- [ ] I have checked if extracting `validTransitions` to a shared module would create circular dependencies
- [ ] I have checked `services/TicketService.js` — does it use `Ticket.validTransitions` or define its own?

### Testing Strategy

- [ ] Verify `Ticket.update()` validation still works after extracting validTransitions
- [ ] Verify `Ticket.updateStatus()` validation still works after extracting validTransitions
- [ ] Verify no other code depends on the inline definitions

### Implementation Readiness

- [ ] I have a plan to implement this within the estimated effort
- [ ] I know which files to create vs. modify
- [ ] I know how to test

## Post-Implementation Checklist

- [ ] Only one `validTransitions` definition exists in the codebase
- [ ] Both `Ticket.update()` and `Ticket.updateStatus()` use the shared definition
- [ ] All existing tests pass
- [ ] No circular dependencies introduced
