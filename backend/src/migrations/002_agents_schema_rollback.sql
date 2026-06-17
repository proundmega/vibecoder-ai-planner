-- Rollback: 002_agents_schema.sql
-- Drops agents table created in migration 002
-- WARNING: All agent data will be lost

DROP TABLE IF EXISTS agents CASCADE;
