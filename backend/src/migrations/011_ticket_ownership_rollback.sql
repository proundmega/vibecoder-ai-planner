-- Rollback: 011_ticket_ownership.sql
-- Removes agent coordination columns from tickets
-- WARNING: Agent assignment data will be lost

ALTER TABLE tickets DROP COLUMN IF EXISTS assigned_agent_id;
ALTER TABLE tickets DROP COLUMN IF EXISTS locked_at;
