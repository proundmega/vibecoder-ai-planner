-- Migration: 012_agent_users.sql
-- Agent user support

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_agent BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_roles TEXT[] DEFAULT ARRAY['worker'];
CREATE INDEX IF NOT EXISTS idx_users_is_agent ON users(is_agent);
