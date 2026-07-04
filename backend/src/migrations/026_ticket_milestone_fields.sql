ALTER TABLE tickets ADD COLUMN IF NOT EXISTS milestone_id UUID REFERENCES milestones(id) ON DELETE SET NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS estimate INTEGER CHECK (estimate IS NULL OR estimate > 0);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS depends_on BIGINT[] DEFAULT ARRAY[]::BIGINT[];

CREATE INDEX IF NOT EXISTS idx_tickets_milestone ON tickets(milestone_id);
