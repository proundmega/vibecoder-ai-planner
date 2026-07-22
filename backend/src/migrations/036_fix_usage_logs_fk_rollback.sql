-- Rollback: 036_fix_usage_logs_fk_rollback.sql
-- Revert agent_id FK back to users(id)

ALTER TABLE usage_logs DROP CONSTRAINT IF EXISTS usage_logs_agent_id_fkey;
ALTER TABLE usage_logs ADD CONSTRAINT usage_logs_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES users(id);

DROP INDEX IF EXISTS idx_usage_logs_agent_id;
DROP INDEX IF EXISTS idx_usage_logs_provider_type;
DROP INDEX IF EXISTS idx_usage_logs_created_at;
