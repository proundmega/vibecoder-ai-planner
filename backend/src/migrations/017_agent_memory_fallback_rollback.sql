-- Rollback: 017_agent_memory_fallback.sql
-- Drops the fallback agent_memory table (only if created by fallback)

DROP TRIGGER IF EXISTS update_agent_memory_updated_at_trigger ON agent_memory;
DROP FUNCTION IF EXISTS update_agent_memory_updated_at();
DROP INDEX IF EXISTS idx_agent_memory_project_id;
DROP INDEX IF EXISTS idx_agent_memory_agent_id;
DROP INDEX IF EXISTS idx_agent_memory_created_at;
DROP TABLE IF EXISTS agent_memory;
