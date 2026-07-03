-- Rollback: 031_unify_providers_rollback.sql
-- Remove unified provider columns and indexes

DROP INDEX IF EXISTS idx_project_providers_director;
DROP INDEX IF EXISTS uq_project_providers_single_director;

ALTER TABLE project_providers DROP COLUMN IF EXISTS is_project_director;
ALTER TABLE project_providers DROP COLUMN IF EXISTS routing_rules;
ALTER TABLE project_providers DROP COLUMN IF EXISTS fallback_provider;
ALTER TABLE project_providers DROP COLUMN IF EXISTS endpoint_url;

-- Note: provider_configs table is NOT restored (it was already present before migration)
