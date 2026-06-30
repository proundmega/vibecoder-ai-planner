-- Migration 030: Convert UUID FK columns to BIGINT to match parent table types
--
-- tickets.id is BIGSERIAL, projects.id is BIGSERIAL, agents.id is BIGINT.
-- Original migrations 018 and 021 used UUID for FK columns which causes
-- type mismatch errors. This migration converts existing UUID columns to BIGINT.
--
-- NOTE: Migrations 020, 022-027 were never in apply.js (not applied), so their
-- source files were fixed in-place. Only 018 and 021 needed a separate migration.

-- 018_ticket_phases: ticket_id UUID → BIGINT
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ticket_phases' AND column_name = 'ticket_id' AND data_type = 'uuid') THEN
    ALTER TABLE ticket_phases ALTER COLUMN ticket_id TYPE BIGINT USING NULL;
  END IF;
END $$;

-- 021_agent_heartbeats: current_ticket_id UUID → BIGINT
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_heartbeats' AND column_name = 'current_ticket_id' AND data_type = 'uuid') THEN
    ALTER TABLE agent_heartbeats ALTER COLUMN current_ticket_id TYPE BIGINT USING NULL;
  END IF;
END $$;
