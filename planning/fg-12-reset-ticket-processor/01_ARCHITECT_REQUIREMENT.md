# 01_ARCHITECT_REQUIREMENT.md — Reset TicketProcessor State After Successful Run

**Status**: planned
**Date created**: 2026-06-29
**Author**: AI Assistant
**Scope**: Agent
**Priority**: P2
**Effort**: Small

---

## Requirement

In `agent/src/main/java/com/vibecode/agent/service/TicketProcessor.java`, the `currentTicketId` and `currentStep` tracking variables are only reset to null in the `finally` block inside the `catch` handler (error path). On the successful completion path, these variables retain their last values — `currentStep` stays `"done"` and `currentTicketId` stays set to the last processed ticket ID. Subsequent heartbeats will report incorrect data.

**Current behavior**: After successful ticket processing, heartbeats report the completed ticket's ID and "done" step.
**Expected behavior**: After successful ticket processing, `currentTicketId` and `currentStep` are nulled (or set to "idle" / null).

---

## Existing Infrastructure Audit

### Agent Code Check
- [x] File exists: `agent/src/main/java/com/vibecode/agent/service/TicketProcessor.java` — YES
- [x] Variables exist: `currentTicketId` and `currentStep` — YES (added by PR 4)
- [x] Reset on error: YES (in catch block's finally)
- [ ] Reset on success: NO (missing)

### Key Insight
A single line needs to be added after the successful completion step to reset the state variables.

---

## Scope

### In Scope
- Add `currentTicketId = null; currentStep = null;` after the successful completion block in `processTicket()`

### Out of Scope
- Changes to heartbeat scheduling or frequency
- Changes to the state tracking approach

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `agent/src/main/java/com/vibecode/agent/service/TicketProcessor.java` | MODIFY | Add state reset after done step |

---

## Acceptance Criteria

1. [ ] [Agent] After successful ticket processing, heartbeats report `currentTicketId: null` and `currentStep: null`
2. [ ] [Agent] On error, state is still properly cleared (existing behavior preserved)
3. [ ] [Agent] Java unit tests pass (`mvn test`)

---

## Security Considerations

- None — this is a data accuracy fix, not a security issue
