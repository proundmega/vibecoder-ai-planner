# bp-28: Ticket Feedback Section — Spec

**Target model**: 14B (JavaScript + Java)
**Date**: 2026-06-27

## File Operations

### CREATE: `backend/src/migrations/019_ticket_feedback.sql`

```sql
CREATE TABLE ticket_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    asked_by VARCHAR(64) NOT NULL,
    question TEXT NOT NULL,
    context JSONB,
    answer TEXT,
    answered_by VARCHAR(64),
    asked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    answered_at TIMESTAMPTZ
);

CREATE INDEX idx_feedback_ticket ON ticket_feedback(ticket_id);
CREATE INDEX idx_feedback_pending ON ticket_feedback(ticket_id) WHERE answer IS NULL;
```

### CREATE: `backend/src/services/FeedbackService.js`

**Imports**: `const db = require('../db')`

**Methods**:
```javascript
async function postQuestion(ticketId, askedBy, question, context = {})
  → INSERT INTO ticket_feedback (ticket_id, asked_by, question, context)
    VALUES ($1, $2, $3, $4) RETURNING *

async function answerQuestion(feedbackId, answer, answeredBy)
  → UPDATE ticket_feedback SET answer = $1, answered_by = $2, answered_at = NOW()
    WHERE id = $3 RETURNING *

async function getFeedback(ticketId)
  → SELECT * FROM ticket_feedback WHERE ticket_id = $1 ORDER BY asked_at DESC

async function getPendingFeedback()
  → SELECT tf.*, t.title as ticket_title FROM ticket_feedback tf
    JOIN tickets t ON t.id = tf.ticket_id
    WHERE tf.answer IS NULL ORDER BY tf.asked_at ASC
```

**Exports**: `module.exports = { postQuestion, answerQuestion, getFeedback, getPendingFeedback }`

### CREATE: `backend/src/api/feedback.js`

**Imports**:
```javascript
const express = require('express');
const router = express.Router();
const feedbackService = require('../../services/FeedbackService');
const { verifyToken, agentAuth } = require('../../middleware/auth');
```

**Routes**:
```javascript
// POST /tickets/:id/feedback — agent posts question
router.post('/tickets/:id/feedback', agentAuth, async (req, res) => {
    const { question, context } = req.body;
    const fb = await feedbackService.postQuestion(req.params.id, req.agentId, question, context);
    res.status(201).json({ success: true, data: fb });
});

// GET /tickets/:id/feedback — list feedback for ticket
router.get('/tickets/:id/feedback', verifyToken, async (req, res) => {
    const list = await feedbackService.getFeedback(req.params.id);
    res.json({ success: true, data: list });
});

// POST /feedback/:id/answer — user answers
router.post('/feedback/:id/answer', verifyToken, async (req, res) => {
    const { answer } = req.body;
    const fb = await feedbackService.answerQuestion(req.params.id, answer, req.user.userId);
    res.json({ success: true, data: fb });
});

// GET /feedback/pending — all unanswered (dashboard queue)
router.get('/feedback/pending', verifyToken, async (req, res) => {
    const list = await feedbackService.getPendingFeedback();
    res.json({ success: true, data: list });
});

module.exports = router;
```

### MODIFY: `backend/src/api/v1/index.js`

Add: `router.use('/feedback', require('../feedback'));`

### CREATE: `frontend/src/api/feedback.js`

```javascript
import { get, post } from './client';

export function fetchFeedback(ticketId) { return get(`/api/v1/tickets/${ticketId}/feedback`).catch(() => []); }
export function postQuestion(ticketId, question, context) { return post(`/api/v1/tickets/${ticketId}/feedback`, { question, context }); }
export function answerQuestion(feedbackId, answer) { return post(`/api/v1/feedback/${feedbackId}/answer`, { answer }); }
export function fetchPendingFeedback() { return get('/api/v1/feedback/pending'); }
```

### MODIFY: `frontend/src/views/TicketDetail.vue`

**Add to script setup**:
```javascript
import { ref, onMounted, computed } from 'vue';
import { fetchFeedback, answerQuestion } from '@/api/feedback';

const feedbackList = ref([]);
const pendingCount = computed(() => feedbackList.value.filter(f => !f.answer).length);
const answerText = ref('');
const selectedOption = ref('');

onMounted(async () => {
    feedbackList.value = await fetchFeedback(props.ticketId);
});

async function submitAnswer(feedbackId) {
    const answer = selectedOption.value || answerText.value;
    if (!answer) return;
    await answerQuestion(feedbackId, answer);
    feedbackList.value = await fetchFeedback(props.ticketId);
    selectedOption.value = '';
    answerText.value = '';
}
```

**Add to tabs array**: `{ id: 'feedback', label: 'Feedback', badge: pendingCount }` (after 'planning', before 'comments')

**Add tab panel**:
```html
<div v-if="activeTab === 'feedback'" class="tab-panel">
  <div v-if="pendingCount" class="feedback-banner">
    ⏸️ Awaiting your input ({{ pendingCount }})
  </div>
  <div v-for="fb in feedbackList" :key="fb.id" class="feedback-item">
    <div class="feedback-question">
      <strong>{{ fb.asked_by }}</strong> asked {{ timeAgo(fb.asked_at) }}:
      <p>{{ fb.question }}</p>
      <div v-if="fb.context?.options" class="feedback-options">
        <label v-for="opt in fb.context.options" :key="opt.label">
          <input type="radio" v-model="selectedOption" :value="opt.label" />
          {{ opt.label }} — {{ opt.description }}
        </label>
      </div>
    </div>
    <div v-if="!fb.answer" class="feedback-answer-form">
      <textarea v-model="answerText" placeholder="Additional notes (optional)"></textarea>
      <button @click="submitAnswer(fb.id)" :disabled="!selectedOption && !answerText" class="btn-primary">Submit Answer</button>
    </div>
    <div v-else class="feedback-answer">
      <strong>Answer:</strong> {{ fb.answer }} <em>(by {{ fb.answered_by }})</em>
    </div>
  </div>
</div>
```

### MODIFY: `frontend/src/views/Dashboard.vue`

**Add section** (after project list, before usage):
```javascript
import { fetchPendingFeedback } from '@/api/feedback';
const pendingFeedback = ref([]);

onMounted(async () => {
    pendingFeedback.value = await fetchPendingFeedback();
});
```

```html
<div v-if="pendingFeedback.length" class="dashboard-section">
  <h2>🔔 Needs Your Input ({{ pendingFeedback.length }})</h2>
  <div v-for="fb in pendingFeedback" :key="fb.id" class="feedback-row">
    <router-link :to="`/projects/${/* projectId unknown here */}/tickets/${fb.ticket_id}`">
      {{ fb.ticket_title || 'Ticket' }}: {{ fb.question.substring(0, 60) }}...
    </router-link>
    <span class="time">{{ timeAgo(fb.asked_at) }}</span>
  </div>
</div>
```

### MODIFY: `agent/src/.../ApiService.java`

**Add methods**:
```java
public List<Feedback> getPendingFeedback(String ticketId) { ... }
public void postFeedback(String ticketId, String question, String context) { ... }
```

### MODIFY: `agent/src/.../TicketProcessor.java`

**Before generateContent() in processTicket()**:
```java
List<Feedback> pending = apiService.getPendingFeedback(ticket.getId());
if (!pending.isEmpty()) {
    Feedback latest = pending.get(pending.size() - 1);
    systemPrompt += "\n\nUser feedback on this ticket: " + latest.getAnswer();
}
```

**After generateContent()**, check for `[NEED_FEEDBACK]:` in AI output:
```java
if (aiResponse.contains("[NEED_FEEDBACK]:")) {
    String question = extractBetween(aiResponse, "[NEED_FEEDBACK]:", "[/NEED_FEEDBACK]");
    apiService.postFeedback(ticket.getId(), question, "{}");
    apiService.updateTicketStatus(ticket.getId(), "backlog");
    return;  // skip commit/push
}
```

## Test Expectations

```
✓ POST feedback creates row in ticket_feedback
✓ GET feedback returns list for ticket
✓ POST answer updates row with answer + timestamp
✓ GET /feedback/pending returns only unanswered
✓ Frontend Feedback tab shows correct count badge
✓ Frontend answer form submits and updates list
✓ Dashboard section shows unanswered feedback
```

## Edge Cases to Handle

1. **No options in context**: Allow free-text only answer
2. **Multiple unanswered questions**: Show oldest first; answer each independently
3. **Agent asks on wrong ticket**: Filter by ticket_id — no cross-ticket confusion
4. **Answer already submitted**: Show answer, hide form
