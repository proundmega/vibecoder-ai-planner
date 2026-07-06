# 02_ARCHITECT_DESIGN.md — Reset TicketProcessor State After Successful Run

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Agent
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

The `TicketProcessor` tracks `currentTicketId` and `currentStep` for heartbeat reporting. On error, these are cleared in a `finally` block. On success, they retain their final values (`"done"` and the ticket ID), causing heartbeats to report stale data.

---

## Current State

```java
apiService.updateTicketStatus(pickedUp.getId(), "review");
log.info("Ticket {} status updated to review", pickedUp.getId());
currentStep = "done";
// <-- MISSING: currentTicketId = null; currentStep = null;
```

### Gap Analysis
The error path already has the reset logic. The success path just needs the same two lines.

---

## Design

### Option A: Add reset after "done" step (Recommended)

Add `currentTicketId = null; currentStep = null;` after `currentStep = "done";` in the success path. The tick processor will then loop and pick up the next ticket, setting these again when it starts.

### Option B: Reset at the start of the next iteration
- **Cons**: The gap between completion and next iteration is when stale data is reported
- **Decision**: Reset immediately after done

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `agent/src/main/java/com/vibecode/agent/service/TicketProcessor.java` | MODIFY | Add 2 lines after currentStep = "done" |

---

## Data Flow

```
[Process ticket] → [Set currentTicketId at start] → [Update currentStep through phases] → [currentStep = "done"] → [RESET both to null] → [Next poll iteration]
```
