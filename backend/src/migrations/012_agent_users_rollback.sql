-- Rollback: 012_agent_users.sql
-- Removes agent-specific columns from users
-- WARNING: Agent configuration data will be lost

ALTER TABLE users DROP COLUMN IF EXISTS is_agent;
ALTER TABLE users DROP COLUMN IF EXISTS agent_roles;
