CREATE TABLE IF NOT EXISTS deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id BIGINT NOT NULL REFERENCES tickets(id),
    environment_id UUID NOT NULL REFERENCES environments(id),
    status VARCHAR(16) DEFAULT 'pending',
    commit_sha VARCHAR(64),
    deployed_at TIMESTAMPTZ DEFAULT NOW(),
    rolled_back_at TIMESTAMPTZ,
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_deployments_ticket ON deployments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_deployments_environment ON deployments(environment_id);
