-- GitHub App installation mapping per project (fg-35 FR2/FR7)
CREATE TABLE IF NOT EXISTS project_github_installations (
    project_id BIGINT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    installation_id BIGINT NOT NULL,
    repo_allowlist TEXT[] NOT NULL DEFAULT '{}',
    disabled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_github_installations_installation_id
    ON project_github_installations(installation_id);
