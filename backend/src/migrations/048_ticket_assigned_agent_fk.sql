-- Migration: 048_ticket_assigned_agent_fk.sql
-- O4: tickets.assigned_agent_id must reference agents(id), not users(id).
--
-- 011 created the column with REFERENCES users(id) and callers stored the
-- agent's owner user id. This migration:
--   1. drops that foreign key,
--   2. maps each stored owner user id to the agent owned by that user
--      (the oldest agent wins when an owner has several),
--   3. clears any value with no agent mapping so it cannot be misread later,
--   4. adds the agents(id) foreign key with ON DELETE SET NULL.
--
-- The guard makes this file safe to re-run: once the new constraint exists the
-- block returns without touching data.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'tickets'
      AND constraint_name = 'tickets_assigned_agent_id_agent_fkey'
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'tickets'
      AND constraint_name = 'tickets_assigned_agent_id_fkey'
  ) THEN
    ALTER TABLE tickets DROP CONSTRAINT tickets_assigned_agent_id_fkey;
  END IF;

  CREATE TEMP TABLE _ticket_agent_map ON COMMIT DROP AS
  SELECT t.id AS ticket_id, a.id AS agent_id
  FROM tickets t
  JOIN (
    SELECT DISTINCT ON (owner_id) owner_id, id
    FROM agents
    WHERE owner_id IS NOT NULL
    ORDER BY owner_id, id
  ) a ON a.owner_id = t.assigned_agent_id
  WHERE t.assigned_agent_id IS NOT NULL;

  -- Old user ids with no matching agent cannot be preserved as agent ids.
  UPDATE tickets t
  SET assigned_agent_id = NULL, locked_at = NULL
  WHERE t.assigned_agent_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM _ticket_agent_map m WHERE m.ticket_id = t.id
    );

  UPDATE tickets t
  SET assigned_agent_id = m.agent_id
  FROM _ticket_agent_map m
  WHERE t.id = m.ticket_id;

  DROP TABLE _ticket_agent_map;

  ALTER TABLE tickets
    ADD CONSTRAINT tickets_assigned_agent_id_agent_fkey
    FOREIGN KEY (assigned_agent_id) REFERENCES agents(id) ON DELETE SET NULL;
END $$;
