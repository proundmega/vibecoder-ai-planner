-- Migration: 036_fix_usage_logs_fk.sql
-- Fix agent_id FK: currently references users(id), should reference agents(id)

ALTER TABLE usage_logs DROP CONSTRAINT IF EXISTS usage_logs_agent_id_fkey;
ALTER TABLE usage_logs ADD CONSTRAINT usage_logs_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL;

-- Ensure indexes exist (already created in 013, but idempotent)
CREATE INDEX IF NOT EXISTS idx_usage_logs_agent_id ON usage_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_provider_type ON usage_logs(provider_type);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON usage_logs(created_at);
