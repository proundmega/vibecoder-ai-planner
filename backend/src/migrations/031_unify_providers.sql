-- Migration: 031_unify_providers.sql
-- Unify Provider Config and AI Providers into single project_providers table
-- Add fields from provider_configs and project director concept

ALTER TABLE project_providers ADD COLUMN IF NOT EXISTS endpoint_url VARCHAR(512);
ALTER TABLE project_providers ADD COLUMN IF NOT EXISTS fallback_provider VARCHAR(32);
ALTER TABLE project_providers ADD COLUMN IF NOT EXISTS routing_rules JSONB DEFAULT '{}';
ALTER TABLE project_providers ADD COLUMN IF NOT EXISTS is_project_director BOOLEAN DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_providers_single_director
  ON project_providers(project_id)
  WHERE is_project_director = true;

CREATE INDEX IF NOT EXISTS idx_project_providers_director
  ON project_providers(project_id)
  WHERE is_project_director = true;

-- Migrate data from provider_configs to project_providers if project_providers is empty
-- and provider_configs has data
DO $$
DECLARE
  pc RECORD;
  provider_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO provider_count FROM project_providers;
  
  IF provider_count = 0 THEN
    FOR pc IN SELECT * FROM provider_configs WHERE is_active = true ORDER BY created_at DESC LIMIT 1 LOOP
      INSERT INTO project_providers (
        project_id, name, provider_type, api_key_encrypted, base_url, model,
        roles, max_tokens, temperature, endpoint_url, fallback_provider,
        routing_rules, is_active, is_project_director
      ) VALUES (
        pc.project_id,
        pc.provider || ' (migrated)',
        pc.provider,
        (SELECT api_key_encrypted FROM provider_configs WHERE project_id = pc.project_id AND provider = pc.provider LIMIT 1),
        NULL,
        pc.model,
        ARRAY['worker'],
        4096,
        0.1,
        pc.endpoint_url,
        pc.fallback_provider,
        COALESCE(pc.routing_rules, '{}'),
        true,
        true
      );
    END LOOP;
  END IF;
END $$;

-- Mark provider_configs as deprecated with a comment
COMMENT ON TABLE provider_configs IS 'DEPRECATED: Use project_providers with is_project_director flag instead. Will be removed in a future migration.';
