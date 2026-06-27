# bp-28: Ticket Feedback Section — Agent ↔ Human Structured Q&A

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Both
**Priority**: P1
**Effort**: Large

## Problem Statement

When an agent hits a question it can't answer (ambiguous requirement, compile error, architectural decision), it currently releases the ticket and logs a failure. There's no structured channel for agent→human→agent communication that preserves the workspace. Every agent dead end is permanent — the ticket goes back to the backlog and a human has to re-analyze from scratch.

## Scope

- **In scope**: `ticket_feedback` DB table, backend API endpoints, frontend Feedback tab in TicketDetail.vue, dashboard "Needs your input" queue, agent-side polling for feedback
- **Out of scope**: Web terminal (separate), real-time WebSocket push, workspace preservation across agent restarts

## Acceptance Criteria

- [ ] Migration creates `ticket_feedback` table (id, ticket_id, asked_by, question, context JSONB, answer, answered_by, asked_at, answered_at)
- [ ] Backend API: POST /tickets/:id/feedback — agent posts a question
- [ ] Backend API: GET /tickets/:id/feedback — list all feedback for a ticket
- [ ] Backend API: POST /feedback/:id/answer — user answers
- [ ] Backend API: GET /feedback/pending — all unanswered feedback across all tickets
- [ ] Frontend: "Feedback" tab in TicketDetail.vue showing question threads
- [ ] Frontend: Answer form with option buttons + free-text field
- [ ] Frontend: "Needs your input" queue on Dashboard.vue
- [ ] Agent: Polls for pending feedback before each generation cycle
- [ ] Agent: Posts question + context when stuck, waits for answer

## Known Unknowns

- **Workspace preservation**: The agent currently has no persistent workspace. In bp-24 we add REPO_CLONE_DIR, which solves repo state but not in-memory state. For now, the agent re-fetches the ticket and replays from its last checkpoint after feedback.

## Decisions Required

1. **How does the agent detect it's stuck?**
   - Option A: AI model returns a confidence score; below threshold → ask
   - Option B: Specific phrase in AI output ("[NEED_FEEDBACK]: question")
   - Option C: Agent's Java code has explicit try/catch blocks that trigger feedback
   - **Recommendation**: Option B — simple, model-agnostic, works with any provider

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/migrations/019_ticket_feedback.sql` | CREATE | ticket_feedback table |
| `backend/src/api/feedback.js` | CREATE | Feedback route module |
| `backend/src/services/FeedbackService.js` | CREATE | CRUD for feedback |
| `frontend/src/api/feedback.js` | CREATE | API client |
| `frontend/src/views/TicketDetail.vue` | MODIFY | Add Feedback tab |
| `frontend/src/views/Dashboard.vue` | MODIFY | Add "Needs your input" section |
| `agent/src/.../ApiService.java` | MODIFY | Add feedback API calls |
| `agent/src/.../TicketProcessor.java` | MODIFY | Add feedback check + post logic |

## Dependencies

- **Depends on**: bp-24 (agent writes code — needs workspace to preserve context)
