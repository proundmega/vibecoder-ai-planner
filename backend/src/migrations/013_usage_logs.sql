-- Migration: 013_usage_logs.sql
-- AI usage tracking for cost monitoring

CREATE TABLE IF NOT EXISTS usage_logs (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  user_id BIGINT REFERENCES users(id),
  agent_id BIGINT REFERENCES users(id),
  provider_type VARCHAR(50) NOT NULL,
  model VARCHAR(100) NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_usd DECIMAL(12,6) NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  ticket_id BIGINT REFERENCES tickets(id),
  request_type VARCHAR(50) NOT NULL DEFAULT 'chat',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_usage_logs_project_id ON usage_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_agent_id ON usage_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_logs_model ON usage_logs(model);
