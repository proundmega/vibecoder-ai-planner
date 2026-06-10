# 02_ARCHITECT_DESIGN.md — Agent Orchestration & Ticket Ownership

**Status**: planned
**Date created**: 2026-06-10
**Author**: AI Assistant

---

## Problem Statement

Multiple AI agents working on the same project need coordination. Without ownership, two agents could edit the same file or modify the same ticket simultaneously. We need a mechanism to ensure single-agent ownership per ticket.

---

## Current State

- Tickets have `owner_id` (the user who created the ticket)
- No concept of "working on" a ticket
- No coordination mechanism between agents
- Agents are users with `user` role — no special handling

---

## Design

### Architecture

```
Agent (User) → Ticket Service → Check ownership → Allow/Deny
                            ↓
                      Shared Messages (per ticket)
                            ↓
                      Status-based workflow
```

### Database Schema

```sql
-- Add to tickets table
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assigned_agent_id BIGINT REFERENCES users(id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP;

-- New table for agent coordination messages
CREATE TABLE IF NOT EXISTS ticket_messages (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT REFERENCES tickets(id) ON DELETE CASCADE,
  user_id BIGINT REFERENCES users(id),
  message_type VARCHAR(50) NOT NULL DEFAULT 'update',  -- 'update'|'question'|'handoff'|'status'
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ticket_messages_ticket_id ON ticket_messages(ticket_id);
CREATE INDEX idx_ticket_messages_user_id ON ticket_messages(user_id);
CREATE INDEX idx_ticket_messages_created_at ON ticket_messages(created_at);
```

### Ticket Ownership Model

```
Ticket States:
  backlog        → No owner, any agent can pick up
  in_progress    → Has assigned_agent_id, locked to that agent
  review         → No owner, awaiting review
  done           → No owner, completed

Ownership Rules:
  1. Agent picks up ticket from backlog → sets assigned_agent_id, locked_at
  2. Only assigned_agent_id can modify ticket (except admins)
  3. Ticket moves to review → clears assigned_agent_id, locked_at
  4. Ticket moves to backlog → clears assigned_agent_id, locked_at
  5. Admin can force-release ownership
```

### Service Layer — Ownership Checks

```javascript
// backend/src/services/TicketService.js

async function pickUpTicket(ticketId, agentId) {
  const ticket = await Ticket.find(ticketId);
  
  if (ticket.status !== 'backlog') {
    throw new ValidationError('Only backlog tickets can be picked up');
  }
  
  if (ticket.assigned_agent_id) {
    throw new ValidationError('Ticket already assigned to another agent');
  }
  
  const result = await pool.query(
    `UPDATE tickets 
     SET assigned_agent_id = $1, locked_at = CURRENT_TIMESTAMP, status = 'in_progress'
     WHERE id = $2 RETURNING *`,
    [agentId, ticketId]
  );
  
  return new Ticket(result.rows[0]);
}

async function releaseTicket(ticketId, adminId) {
  const ticket = await Ticket.find(ticketId);
  
  if (!ticket.assigned_agent_id) {
    throw new ValidationError('Ticket is not assigned to any agent');
  }
  
  const result = await pool.query(
    `UPDATE tickets 
     SET assigned_agent_id = NULL, locked_at = NULL, status = 'backlog'
     WHERE id = $1 RETURNING *`,
    [ticketId]
  );
  
  return new Ticket(result.rows[0]);
}

// Middleware-like check in controller
function enforceOwnership(req, res, next) {
  const ticket = req.ticket;
  const user = req.user;
  
  if (ticket.assigned_agent_id && ticket.assigned_agent_id !== user.userId) {
    // Check if user is admin
    if (!user.isAdmin) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'TICKET_LOCKED',
          message: `Ticket is being worked on by agent ${ticket.assigned_agent_id}`
        }
      });
    }
  }
  
  next();
}
```

### Shared Messages — Coordination

```javascript
// backend/src/services/MessageService.js

async function postMessage(ticketId, userId, messageType, content, metadata = {}) {
  const result = await pool.query(
    `INSERT INTO ticket_messages (ticket_id, user_id, message_type, content, metadata)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [ticketId, userId, messageType, content, JSON.stringify(metadata)]
  );
  return result.rows[0];
}

async function getTicketMessages(ticketId, limit = 50) {
  const result = await pool.query(
    `SELECT tm.*, u.name as user_name, u.email as user_email
     FROM ticket_messages tm
     JOIN users u ON tm.user_id = u.id
     WHERE tm.ticket_id = $1
     ORDER BY tm.created_at DESC
     LIMIT $2`,
    [ticketId, limit]
  );
  return result.rows;
}
```

### Agent-as-User Pattern

Agents are users with a special flag:
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_agent BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_roles TEXT[] DEFAULT ARRAY['worker'];
```

**Agent roles:**
- `planner` — breaks down tickets, creates subtasks
- `worker` — writes code, creates PRs
- `reviewer` — reviews code, comments on PRs
- `approver` — approves PRs, marks tickets done

**Role assignment:**
- Agents can have multiple roles
- Provider router assigns different AI models per role
- Agent type stored in `users` table, not separate table

### Message Types

| Type | Use Case | Example |
|------|----------|---------|
| `update` | Progress update | "Fixed auth middleware, pushed to branch" |
| `question` | Need clarification | "Should I use JWT or session auth?" |
| `handoff` | Transfer ownership | "Done with coding, handing off for review" |
| `status` | Status change | "PR created: github.com/owner/repo/pull/42" |

### Orphaned Ownership Recovery

If an agent crashes mid-work:
```javascript
// Cron job or manual trigger
async function recoverOrphanedTickets(staleMinutes = 60) {
  const result = await pool.query(
    `UPDATE tickets 
     SET assigned_agent_id = NULL, locked_at = NULL, status = 'backlog'
     WHERE status = 'in_progress' 
     AND locked_at < NOW() - INTERVAL '${staleMinutes} minutes'
     AND assigned_agent_id IS NOT NULL
     RETURNING id, title`
  );
  
  for (const ticket of result.rows) {
    // Log recovery, notify project_admin
    logger.warn(`Recovered orphaned ticket ${ticket.id}: ${ticket.title}`);
  }
  
  return result.rows;
}
```

---

## Dependencies

- **users.is_agent** — new column to identify agent users
- **users.agent_roles** — array of roles for agent
- **ProviderRouter** — assigns models per role (rs-14)

---

## Risks/Edge Cases

- **[Agent crash]**: Agent dies mid-work — ticket locked indefinitely — add stale ticket recovery
- **[Manual release]**: Project admin needs to force-release ownership — add admin endpoint
- **[Message volume]**: High message volume — paginate with limit, archive old messages
- **[Ownership race]**: Two agents pick up same ticket simultaneously — use `WHERE status = 'backlog' AND assigned_agent_id IS NULL` in UPDATE
- **[Admin override]**: Admin can release any ticket, even if not stale

---

## Migration Notes

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

*This document defines the design for agent orchestration. See `01_ARCHITECT_REQUIREMENT.md` for requirements and `03_ARCHITECT_IMPLEMENTATION.md` for implementation details.*
