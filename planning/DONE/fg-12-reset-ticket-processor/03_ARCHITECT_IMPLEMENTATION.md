# 03_ARCHITECT_IMPLEMENTATION.md — Reset TicketProcessor State After Successful Run

---

## Ticket: fg-12 — Reset TicketProcessor state after successful run

**Status**: planned
**Priority**: P2
**Effort**: Small
**Author**: AI Assistant
**Date created**: 2026-06-29
**Scope**: Agent

**Dependencies**: None

---

### a) Purpose

Clear `currentTicketId` and `currentStep` after successful ticket processing so heartbeats don't report stale data.

---

### b) Actions

#### Implementation Order

1. **Add state reset** — `agent/src/main/java/com/vibecode/agent/service/TicketProcessor.java`
   - After `currentStep = "done";` (line ~211 in the heartbeats PR diff), add:
     ```java
     currentTicketId = null;
     currentStep = null;
     ```
   - The result is that between processing tickets, the agent reports idle state

---

### c) Per-File Action Plan

#### `agent/src/main/java/com/vibecode/agent/service/TicketProcessor.java` (MODIFY)

**Current code (after successful completion):**
```java
apiService.updateTicketStatus(pickedUp.getId(), "review");
log.info("Ticket {} status updated to review", pickedUp.getId());
currentStep = "done";
```

**Changed code:**
```java
apiService.updateTicketStatus(pickedUp.getId(), "review");
log.info("Ticket {} status updated to review", pickedUp.getId());
currentStep = "done";
currentTicketId = null;
currentStep = null;
```

---

### d) Dependencies

- No new dependencies

---

### e) Risks/Edge Cases

- **[Race condition]**: If a new ticket is picked up before the heartbeat fires, the null values will be immediately overwritten — this is correct behavior (the new ticket's ID will be reported)
- **[Test impact]**: Existing tests for `processTicket` may need to verify the reset behavior

---

### f) Testing

#### Agent Tests
- [ ] `mvn test` passes (verify existing TicketProcessor tests still pass)
- [ ] If tests track currentTicketId after completion, update them to expect null

---

### g) Files Changed

**Agent:**
```
agent/src/main/java/com/vibecode/agent/service/TicketProcessor.java   → MODIFY
```
