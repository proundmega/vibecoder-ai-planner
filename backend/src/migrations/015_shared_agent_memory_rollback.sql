-- Rollback: 015_shared_agent_memory.sql
-- Drops agent_memory table and vector extension
-- WARNING: All shared memory data will be lost

DROP TABLE IF EXISTS agent_memory CASCADE;
DROP EXTENSION IF EXISTS vector;
