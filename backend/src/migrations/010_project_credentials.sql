-- Migration: 010_project_credentials.sql
-- Secure credential storage for AI providers and GitHub

CREATE TABLE IF NOT EXISTS project_credentials (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  credential_type VARCHAR(50) NOT NULL DEFAULT 'anthropic',
  key_encrypted TEXT NOT NULL,
  key_masked VARCHAR(20) NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_by BIGINT REFERENCES users(id),
  expires_at TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT valid_credential_type CHECK (credential_type IN ('anthropic', 'openai', 'github', 'custom'))
);

CREATE INDEX IF NOT EXISTS idx_project_credentials_project_id ON project_credentials(project_id);
CREATE INDEX IF NOT EXISTS idx_project_credentials_is_active ON project_credentials(is_active);
CREATE INDEX IF NOT EXISTS idx_project_credentials_type ON project_credentials(credential_type);
