DROP INDEX IF EXISTS idx_ticket_phases_ticket;
DROP TABLE IF EXISTS ticket_phases;
ALTER TABLE tickets DROP COLUMN IF EXISTS phase;
