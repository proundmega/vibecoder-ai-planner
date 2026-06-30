-- Migration: 021_agent_heartbeats.sql
-- Agent heartbeat tracking for liveness detection

CREATE TABLE IF NOT EXISTS agent_heartbeats (
    agent_id BIGINT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    current_ticket_id UUID REFERENCES tickets(id),
    current_step VARCHAR(64),
    memory_usage JSONB DEFAULT '{}',
    cpu_usage JSONB DEFAULT '{}',
    status VARCHAR(16) NOT NULL DEFAULT 'online'
);

CREATE INDEX IF NOT EXISTS idx_agent_heartbeats_status ON agent_heartbeats(status);
CREATE INDEX IF NOT EXISTS idx_agent_heartbeats_last_seen ON agent_heartbeats(last_seen);
