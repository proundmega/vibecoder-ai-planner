-- Migration: 011_ticket_ownership.sql
-- Ticket ownership for agent coordination

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assigned_agent_id BIGINT REFERENCES users(id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_tickets_assigned_agent_id ON tickets(assigned_agent_id);

-- New table for agent coordination messages
CREATE TABLE IF NOT EXISTS ticket_messages (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT REFERENCES tickets(id) ON DELETE CASCADE,
  user_id BIGINT REFERENCES users(id),
  message_type VARCHAR(50) NOT NULL DEFAULT 'update',
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_id ON ticket_messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_user_id ON ticket_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_created_at ON ticket_messages(created_at);
