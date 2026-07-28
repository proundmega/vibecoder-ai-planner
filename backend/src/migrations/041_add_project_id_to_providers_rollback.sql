DROP INDEX IF EXISTS idx_providers_project_id;
ALTER TABLE providers DROP COLUMN IF EXISTS project_id;
