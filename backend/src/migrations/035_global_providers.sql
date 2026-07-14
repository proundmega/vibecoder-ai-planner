-- Create global providers table
CREATE TABLE IF NOT EXISTS providers (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  provider_type VARCHAR(50) NOT NULL DEFAULT 'claude',
  api_key_encrypted TEXT,
  base_url TEXT,
  model VARCHAR(100) NOT NULL,
  roles TEXT[] NOT NULL DEFAULT ARRAY['worker'],
  max_tokens INTEGER DEFAULT 4096,
  temperature DECIMAL(3,2) DEFAULT 0.1,
  endpoint_url VARCHAR(512),
  fallback_provider VARCHAR(32),
  routing_rules JSONB DEFAULT '{}',
  is_project_director BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE providers DROP CONSTRAINT IF EXISTS unique_provider_name_type;
ALTER TABLE providers ADD CONSTRAINT unique_provider_name_type UNIQUE (name, provider_type);

-- Ensure api_key_encrypted allows NULL (for providers without API keys like local LLMs)
ALTER TABLE providers ALTER COLUMN api_key_encrypted DROP NOT NULL;

-- Add provider_id to agents
ALTER TABLE agents ADD COLUMN IF NOT EXISTS provider_id BIGINT REFERENCES providers(id) ON DELETE SET NULL;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_providers_type ON providers(provider_type);
CREATE INDEX IF NOT EXISTS idx_agents_provider_id ON agents(provider_id);

-- Migrate data from project_providers
INSERT INTO providers (name, provider_type, api_key_encrypted, base_url, model, roles,
                       max_tokens, temperature, endpoint_url, fallback_provider, routing_rules,
                       is_project_director, is_active, created_at, updated_at)
SELECT DISTINCT ON (name, provider_type)
  name, provider_type, api_key_encrypted, base_url, model, roles,
  max_tokens, temperature, COALESCE(endpoint_url, NULL), fallback_provider,
  routing_rules, is_project_director, is_active, created_at, updated_at
FROM project_providers
WHERE is_active = true
ORDER BY name, provider_type, created_at ASC
ON CONFLICT (name, provider_type) DO NOTHING;
