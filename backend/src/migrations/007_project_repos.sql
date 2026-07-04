-- Migration: 007_project_repos.sql
-- GitHub repository integration for Vibecode projects

-- Project repositories table (stores encrypted GitHub PAT)
CREATE TABLE IF NOT EXISTS project_repos (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL DEFAULT 'github',
  repo_url TEXT NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  default_branch VARCHAR(255) DEFAULT 'main',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT valid_provider CHECK (provider = 'github'),
  CONSTRAINT unique_project_repo UNIQUE (project_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_project_repos_project_id ON project_repos(project_id);
CREATE INDEX IF NOT EXISTS idx_project_repos_is_active ON project_repos(is_active);
