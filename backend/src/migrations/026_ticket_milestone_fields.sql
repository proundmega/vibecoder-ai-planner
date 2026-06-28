ALTER TABLE tickets ADD COLUMN milestone_id UUID REFERENCES milestones(id) ON DELETE SET NULL;
ALTER TABLE tickets ADD COLUMN estimate INTEGER CHECK (estimate IS NULL OR estimate > 0);
ALTER TABLE tickets ADD COLUMN depends_on UUID[] DEFAULT ARRAY[]::UUID[];

CREATE INDEX idx_tickets_milestone ON tickets(milestone_id);
