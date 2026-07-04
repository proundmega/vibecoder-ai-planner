-- Add phase column to tickets with existing status mapping
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tickets' AND column_name = 'phase') THEN
    ALTER TABLE tickets ADD COLUMN phase VARCHAR(32) NOT NULL DEFAULT 'draft';
  END IF;
END $$;

-- Map existing statuses to phases
UPDATE tickets SET phase = 'draft' WHERE status = 'backlog';
UPDATE tickets SET phase = 'in_progress' WHERE status = 'in_progress';
UPDATE tickets SET phase = 'review' WHERE status = 'review';
UPDATE tickets SET phase = 'done' WHERE status = 'done';

-- Phase transition log
CREATE TABLE IF NOT EXISTS ticket_phases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    from_phase VARCHAR(32),
    to_phase VARCHAR(32) NOT NULL,
    actor_type VARCHAR(16) NOT NULL DEFAULT 'system',
    actor_id VARCHAR(64),
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_phases_ticket ON ticket_phases(ticket_id);
