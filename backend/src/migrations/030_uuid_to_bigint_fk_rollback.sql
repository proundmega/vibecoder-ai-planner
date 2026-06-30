-- Rollback for migration 030: Convert BIGINT FK columns back to UUID
-- WARNING: This rollback converts BIGINT columns to UUID, which will fail
-- if any non-NULL values exist that aren't valid UUIDs.

-- 018_ticket_phases: ticket_id BIGINT → UUID
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ticket_phases' AND column_name = 'ticket_id' AND data_type = 'bigint') THEN
    ALTER TABLE ticket_phases ALTER COLUMN ticket_id TYPE UUID USING NULL;
  END IF;
END $$;

-- 021_agent_heartbeats: current_ticket_id BIGINT → UUID
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_heartbeats' AND column_name = 'current_ticket_id' AND data_type = 'bigint') THEN
    ALTER TABLE agent_heartbeats ALTER COLUMN current_ticket_id TYPE UUID USING NULL;
  END IF;
END $$;
