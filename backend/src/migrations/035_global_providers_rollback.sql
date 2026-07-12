-- Drop providers table
DROP TABLE IF EXISTS providers CASCADE;

-- Remove provider_id from agents
ALTER TABLE agents DROP COLUMN IF EXISTS provider_id;

-- Drop indexes (will be dropped with table, but explicit for clarity)
DROP INDEX IF EXISTS idx_providers_type;
DROP INDEX IF EXISTS idx_agents_provider_id;
