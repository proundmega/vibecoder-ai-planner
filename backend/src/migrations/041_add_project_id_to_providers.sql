-- Add project_id to providers for per-project provider configs
ALTER TABLE providers ADD COLUMN IF NOT EXISTS project_id BIGINT REFERENCES projects(id);
CREATE INDEX IF NOT EXISTS idx_providers_project_id ON providers(project_id);
