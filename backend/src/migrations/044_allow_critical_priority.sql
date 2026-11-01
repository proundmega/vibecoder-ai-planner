-- Migration: 044_allow_critical_priority.sql
-- The UI (PhaseDraft.vue) and the Joi validators allow a "critical" priority,
-- but the original 001_create_tables.sql CHECK constraint only allowed
-- low/medium/high/urgent. Creating or updating a ticket with priority
-- "critical" therefore passed validation and failed at the database layer.
--
-- Widen the constraint so the API, the UI and the schema agree.

ALTER TABLE tickets DROP CONSTRAINT IF EXISTS valid_priorities;

ALTER TABLE tickets ADD CONSTRAINT valid_priorities
  CHECK (priority IN ('low', 'medium', 'high', 'critical', 'urgent'));
