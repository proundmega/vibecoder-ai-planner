-- Agent management tables

-- Agents table (stores API key configurations)
CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    api_key TEXT UNIQUE,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rate_limit INTEGER DEFAULT 100,
    max_actions_per_day INTEGER DEFAULT 1000,
    current_daily_usage INTEGER DEFAULT 0,
    last_reset_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Agent actions tracking table (for billing/rate limiting)
CREATE TABLE IF NOT EXISTS agent_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL,
    table_name TEXT,
    record_id UUID,
    cost_incurred DECIMAL(10, 8) DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index on agent_id for efficient queries
CREATE INDEX IF NOT EXISTS idx_agent_actions_agent_id ON agent_actions(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_actions_created_at ON agent_actions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agents_api_key ON agents(api_key);
CREATE INDEX IF NOT EXISTS idx_agents_owner_id ON agents(owner_id);

-- Update agents table timestamps trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER IF NOT EXISTS trigger_update_agents_updated_at
    BEFORE UPDATE ON agents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
