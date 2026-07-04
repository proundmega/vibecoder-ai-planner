-- Migration: 009_project_providers.sql
-- AI provider configuration for Vibecode projects

CREATE TABLE IF NOT EXISTS project_providers (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  provider_type VARCHAR(50) NOT NULL DEFAULT 'claude',
  api_key_encrypted TEXT NOT NULL,
  base_url TEXT,
  model VARCHAR(100) NOT NULL,
  roles TEXT[] NOT NULL DEFAULT ARRAY['worker'],
  max_tokens INTEGER DEFAULT 4096,
  temperature DECIMAL(3,2) DEFAULT 0.1,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT valid_provider_type CHECK (provider_type IN ('claude', 'openai', 'generic', 'ollama', 'vllm', 'llamacpp', 'custom')),
  CONSTRAINT valid_roles CHECK (array_length(roles, 1) > 0)
);

CREATE INDEX IF NOT EXISTS idx_project_providers_project_id ON project_providers(project_id);
CREATE INDEX IF NOT EXISTS idx_project_providers_is_active ON project_providers(is_active);
CREATE INDEX IF NOT EXISTS idx_project_providers_roles ON project_providers USING GIN(roles);
