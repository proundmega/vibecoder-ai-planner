# bp-28: Ticket Feedback Section — Design

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Both

## Current State

No feedback mechanism exists. Agent failures are logged and tickets are released back to backlog. The frontend has no "Needs input" queue. Comments exist on tickets but are unstructured (no dedicated agent→human format).

## Proposed Solution

### Database Table

```sql
CREATE TABLE ticket_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    asked_by VARCHAR(64) NOT NULL,           -- agent ID
    question TEXT NOT NULL,
    context JSONB,                            -- { file, line, terminal_output, options: [{label, description}], agent_recommendation }
    answer TEXT,                              -- null until answered
    answered_by VARCHAR(64),                  -- user ID, null until answered
    asked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    answered_at TIMESTAMPTZ
);

CREATE INDEX idx_feedback_ticket ON ticket_feedback(ticket_id);
CREATE INDEX idx_feedback_pending ON ticket_feedback(ticket_id) WHERE answer IS NULL;
```

### Backend API

| Method | Path | Purpose |
|--------|------|---------|
| POST | /api/v1/tickets/:id/feedback | Agent posts a question |
| GET | /api/v1/tickets/:id/feedback | List all feedback for ticket |
| POST | /api/v1/feedback/:id/answer | User answers a question |
| GET | /api/v1/feedback/pending | All unanswered (dashboard queue) |

### Frontend: Feedback Tab

New tab in TicketDetail.vue alongside Overview, Planning, Comments:

```
Tabs: Overview | Planning | Feedback (1) | Comments

Feedback Tab:
  - Section per question thread
  - Unanswered: banner "Awaiting your input", question, context box, options radio, free-text field, submit
  - Answered: grayed with answer text, answered_by, answered_at
  - Ordered by asked_at descending
```

### Frontend: Dashboard Queue

New card/row in Dashboard.vue:
```
🔔 Needs Your Input (2)
  · TICKET-42: "Should I use NotificationService or..."  15m ago
  · TICKET-38: "The CSS breakpoint conflicts with..."     42m ago
```

Each row links to corresponding ticket with feedback tab highlighted.

### Agent Integration

In `TicketProcessor.java`, before each AI generation cycle:

```java
// Check for pending answers
List<Feedback> pending = apiService.getPendingFeedback(ticketId);
if (!pending.isEmpty()) {
    Feedback latest = pending.get(pending.size() - 1);
    workspaceContext.addNote("User feedback: " + latest.getAnswer());
}

// After generation, check if AI needs help
if (aiResponse.contains("[NEED_FEEDBACK]:")) {
    String question = extractQuestion(aiResponse);
    String context = extractContext(aiResponse);
    apiService.postFeedback(ticketId, question, context);
    // Release ticket (can't wait synchronously for long)
    apiService.updateTicketStatus(ticketId, "backlog");
    return;
}
```

### FeedbackService

```javascript
class FeedbackService {
    async postQuestion(ticketId, askedBy, question, context) { ... }
    async answerQuestion(feedbackId, answer, answeredBy) { ... }
    async getFeedback(ticketId) { ... }
    async getPendingFeedback() { ... }  // all unanswered
    async getPendingCount() { ... }     // count for badge
}
```

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/migrations/019_ticket_feedback.sql` | CREATE | ticket_feedback table + indexes |
| `backend/src/services/FeedbackService.js` | CREATE | postQuestion, answerQuestion, getFeedback, getPendingFeedback |
| `backend/src/api/feedback.js` | CREATE | Express router with 4 endpoints |
| `backend/src/api/v1/index.js` | MODIFY | Mount /feedback routes |
| `frontend/src/api/feedback.js` | CREATE | API client functions |
| `frontend/src/views/TicketDetail.vue` | MODIFY | Add Feedback tab + answer form |
| `frontend/src/views/Dashboard.vue` | MODIFY | Add pending feedback queue |
| `agent/src/.../ApiService.java` | MODIFY | Add getPendingFeedback, postFeedback |
| `agent/src/.../TicketProcessor.java` | MODIFY | Check feedback before generation, post when stuck |

## Alternatives Considered

- **Alternative: Use existing comments for feedback** — Rejected because comments are unstructured. Feedback needs machine-readable context (file, line, terminal output, options) that comments don't support.
