# bp-28: Ticket Feedback Section — Implementation

**Status**: planned
**Priority**: P1
**Effort**: Large
**Scope**: Both

## Purpose
Structured agent→human→agent Q&A so agents can get unstuck without releasing tickets.

## Implementation Order

1. **Create migration** — 019_ticket_feedback.sql + rollback
   - *Depends on*: nothing

2. **Create FeedbackService.js** — `backend/src/services/FeedbackService.js`
   - postQuestion, answerQuestion, getFeedback, getPendingFeedback
   - *Depends on*: Step 1

3. **Create feedback API routes** — `backend/src/api/feedback.js`
   - POST /tickets/:id/feedback
   - GET /tickets/:id/feedback
   - POST /feedback/:id/answer
   - GET /feedback/pending
   - *Depends on*: Step 2

4. **Mount feedback routes** — `backend/src/api/v1/index.js`
   - *Depends on*: Step 3

5. **Create frontend API client** — `frontend/src/api/feedback.js`
   - *Depends on*: Step 3

6. **Add Feedback tab to TicketDetail.vue** — `frontend/src/views/TicketDetail.vue`
   - New tab "Feedback" with question threads and answer form
   - *Depends on*: Step 5

7. **Add "Needs your input" to Dashboard.vue** — `frontend/src/views/Dashboard.vue`
   - Pending feedback queue section
   - *Depends on*: Step 5

8. **Modify Java agent** — `agent/src/.../ApiService.java` + `TicketProcessor.java`
   - Add feedback polling and posting
   - *Depends on*: Step 3

## Per-File Action Plan

### `backend/src/services/FeedbackService.js` (CREATE)
- `async postQuestion(ticketId, askedBy, question, context)` → INSERT into ticket_feedback
- `async answerQuestion(feedbackId, answer, answeredBy)` → UPDATE SET answer, answered_by, answered_at
- `async getFeedback(ticketId)` → SELECT * WHERE ticket_id = $1 ORDER BY asked_at DESC
- `async getPendingFeedback()` → SELECT * WHERE answer IS NULL ORDER BY asked_at ASC
- `async getPendingCount()` → SELECT COUNT(*) WHERE answer IS NULL

### `backend/src/api/feedback.js` (CREATE)
- 4 routes following existing patterns (verifyToken, Joi validation)
- Agent routes use agentAuth middleware

### `frontend/src/api/feedback.js` (CREATE)
- `import { get, post } from './client'`
- `fetchFeedback(ticketId)`, `postQuestion(ticketId, question, context)`, `answerQuestion(feedbackId, answer)`, `fetchPendingFeedback()`

### `frontend/src/views/TicketDetail.vue` (MODIFY)
- Add `'Feedback'` to tabs array
- Add `<div v-if="activeTab === 'feedback'">` with question list and answer form
- Follow existing tab style: `.tab-panel`, `.tab-button`

### `frontend/src/views/Dashboard.vue` (MODIFY)
- Add section below project list showing pending feedback
- Each row links to `/projects/:id/tickets/:ticketId` with feedback tab

## Test Plan
1. POST feedback as agent → verify stored in DB
2. GET feedback list → verify returned
3. Answer feedback → verify marked as answered
4. GET /feedback/pending → returns only unanswered
5. Frontend shows Feedback tab with correct count badge
6. Dashboard shows pending feedback queue

## Rollback Steps
1. Run 019_rollback.sql
2. Remove from apply.js
3. Revert frontend files
