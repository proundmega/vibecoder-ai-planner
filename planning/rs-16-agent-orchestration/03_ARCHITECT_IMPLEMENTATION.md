# 03_ARCHITECT_IMPLEMENTATION.md — Agent Orchestration & Ticket Ownership

**Status**: planned
**Priority**: P1
**Effort**: Medium
**Author**: AI Assistant
**Date created**: 2026-06-10
**Date completed**: TBD
**PR**: TBD
**Branch**: rs-16-agent-orchestration

**Dependencies**: rs-15-api-keys (agents need credentials), rs-14-openai-endpoints (agents need providers)

---

### a) Purpose

Enable multiple AI agents to work on the same project without conflicts. Ticket ownership ensures only one agent modifies a ticket at a time. Shared messages allow agents to coordinate progress, ask questions, and hand off work.

**Value delivered**: Safe multi-agent collaboration on the same project. No file conflicts, no ticket conflicts, clear coordination trail.

---

### b) Actions

1. **Create migrations**
   ```
   backend/src/migrations/011_ticket_ownership.sql
     - tickets: assigned_agent_id, locked_at columns
     - ticket_messages table (messages, questions, handoffs)
   
   backend/src/migrations/012_agent_users.sql
     - users: is_agent, agent_roles columns
   ```

2. **Create MessageService** — `backend/src/services/MessageService.js`
   - `postMessage(ticketId, userId, type, content, metadata)`
   - `getTicketMessages(ticketId, limit)`
   - `getUnreadMessages(userId, since)`

3. **Update TicketService** — `backend/src/services/TicketService.js`
   - `pickUpTicket(ticketId, agentId)` → sets assigned_agent_id, locked_at
   - `releaseTicket(ticketId, adminId)` → clears ownership
   - `enforceOwnership(ticketId, userId)` → throws if locked by another agent
   - `recoverOrphanedTickets(staleMinutes)` → cron job for stale tickets

4. **Create ticketController additions** — `backend/src/controllers/ticketController.js`
   - `pickUpTicket(req, res, next)` → POST `/api/tickets/:id/pickup`
   - `releaseTicket(req, res, next)` → POST `/api/tickets/:id/release`
   - `getMessages(req, res, next)` → GET `/api/tickets/:id/messages`
   - `postMessage(req, res, next)` → POST `/api/tickets/:id/messages`

5. **Create route modules** — `backend/src/api/tickets.js` (additions)
   - `POST /api/tickets/:id/pickup` — agent picks up ticket
   - `POST /api/tickets/:id/release` — admin releases ticket
   - `GET /api/tickets/:id/messages` — get ticket messages
   - `POST /api/tickets/:id/messages` — post message

6. **Create ownership middleware** — `backend/src/middleware/ticketOwnership.js`
   - `requireTicketOwnership(ticketId, userId)` → 403 if locked by another agent
   - `skipOwnershipForAdmin()` → admins bypass ownership check

7. **Create tests**
   - `backend/src/__tests__/ticketOwnership.test.js` — ownership logic tests
   - `backend/src/__tests__/messageService.test.js` — message CRUD tests
   - `backend/src/__tests__/ticketController.test.js` — pickup/release tests

---

### c) Dependencies

- **rs-15-api-keys** — agents need credentials to function
- **rs-14-openai-endpoints** — agents need provider routing
- **users.is_agent** — new column to identify agent users
- **users.agent_roles** — array of roles for agent

---

### d) Risks/Edge Cases

- **[Agent crash]**: Agent dies mid-work — ticket locked indefinitely — add stale ticket recovery (cron)
- **[Manual release]**: Project admin needs to force-release ownership — add admin endpoint
- **[Message volume]**: High message volume — paginate with limit, archive old messages
- **[Ownership race]**: Two agents pick up same ticket simultaneously — use atomic UPDATE with WHERE clause
- **[Admin override]**: Admin can release any ticket, even if not stale

---

### e) Testing

#### Unit Tests
- [ ] TicketService.pickUpTicket() — sets ownership, locks ticket
- [ ] TicketService.pickUpTicket() on in_progress ticket — throws error
- [ ] TicketService.releaseTicket() — clears ownership
- [ ] TicketService.recoverOrphanedTickets() — releases stale tickets
- [ ] MessageService.postMessage() — creates message
- [ ] MessageService.getTicketMessages() — returns messages with user info
- [ ] enforceOwnership() — 403 if locked by another agent
- [ ] enforceOwnership() — allows owner or admin

#### Integration Tests
- [ ] Full lifecycle: pickup → message → release → pickup by another agent
- [ ] Ownership race condition: two agents try to pickup simultaneously
- [ ] Message persistence: messages survive across requests

#### Frontend Tests
- [ ] Component: Ticket messages panel
- [ ] Component: "Assign to me" button (backlog tickets)
- [ ] Component: Ownership indicator (who's working on this)

---

### f) Migration Notes

```sql
-- Migration: 011_ticket_ownership.sql
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assigned_agent_id BIGINT REFERENCES users(id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS ticket_messages (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT REFERENCES tickets(id) ON DELETE CASCADE,
  user_id BIGINT REFERENCES users(id),
  message_type VARCHAR(50) NOT NULL DEFAULT 'update',
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_ticket_messages_ticket_id ON ticket_messages(ticket_id);
CREATE INDEX idx_ticket_messages_user_id ON ticket_messages(user_id);
CREATE INDEX idx_ticket_messages_created_at ON ticket_messages(created_at);

-- Migration: 012_agent_users.sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_agent BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_roles TEXT[] DEFAULT ARRAY['worker'];
CREATE INDEX idx_users_is_agent ON users(is_agent);
```

---

### g) Notes

- Ownership is atomic: `UPDATE tickets SET assigned_agent_id = $1 WHERE id = $2 AND assigned_agent_id IS NULL`
- Stale recovery: cron job runs every 15 minutes, releases tickets locked > 60 minutes
- Messages are append-only — no edit/delete (audit trail)
- Agent roles stored in users table, not separate table — simpler schema
- Provider router assigns different AI models per role (planner → Claude, worker → OpenAI)

---

*This ticket follows the 3 ARCHITECT templates:*
- *`01_ARCHITECT_REQUIREMENT.md` → Requirements, testing checklist, CI requirements*
- *`02_ARCHITECT_DESIGN.md` → Design spec, ownership model, messages, agent-as-user*
- *`03_ARCHITECT_IMPLEMENTATION.md` → Purpose, actions, dependencies, risks, testing*
