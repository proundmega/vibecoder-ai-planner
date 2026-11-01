-- Rollback: 044_allow_critical_priority.sql
-- Restore the original priority constraint. Any ticket that currently uses
-- priority = 'critical' must be re-mapped before running this rollback.

ALTER TABLE tickets DROP CONSTRAINT IF EXISTS valid_priorities;

ALTER TABLE tickets ADD CONSTRAINT valid_priorities
  CHECK (priority IN ('low', 'medium', 'high', 'urgent'));
