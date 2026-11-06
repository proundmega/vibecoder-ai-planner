-- Rollback: 048_ticket_assigned_agent_fk.sql
-- Restores tickets.assigned_agent_id to the legacy users(id) foreign key.
-- Agent ids are mapped back to their owner user id. Values that cannot be
-- mapped are cleared and in_progress tickets are returned to backlog. This
-- loses the agent-vs-owner distinction.

DROP TRIGGER IF EXISTS release_agent_tickets_on_delete ON agents;
DROP FUNCTION IF EXISTS release_agent_tickets_on_delete();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = current_schema()
      AND table_name = 'tickets'
      AND constraint_name = 'tickets_assigned_agent_id_agent_fkey'
  ) THEN
    RETURN;
  END IF;

  ALTER TABLE tickets DROP CONSTRAINT tickets_assigned_agent_id_agent_fkey;

  UPDATE tickets t
  SET assigned_agent_id = a.owner_id
  FROM agents a
  WHERE t.assigned_agent_id = a.id;

  UPDATE tickets t
  SET assigned_agent_id = NULL,
      locked_at = NULL,
      status = CASE WHEN t.status = 'in_progress' THEN 'backlog' ELSE t.status END
  WHERE t.assigned_agent_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t.assigned_agent_id);

  ALTER TABLE tickets
    ADD CONSTRAINT tickets_assigned_agent_id_fkey
    FOREIGN KEY (assigned_agent_id) REFERENCES users(id);
END $$;
