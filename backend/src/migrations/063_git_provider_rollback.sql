-- Rollback: 063_git_provider.sql
-- Fails if non-GitHub provider rows exist; move them back to GitHub first.
-- The auth columns are additive and safe to drop.

ALTER TABLE project_repos DROP CONSTRAINT IF EXISTS valid_auth_mode;
ALTER TABLE project_repos DROP CONSTRAINT IF EXISTS valid_provider;
ALTER TABLE project_repos
  ADD CONSTRAINT valid_provider CHECK (provider = 'github');

ALTER TABLE project_repos DROP COLUMN IF EXISTS ssh_key_encrypted;
ALTER TABLE project_repos DROP COLUMN IF EXISTS auth_mode;
ALTER TABLE project_repos DROP COLUMN IF EXISTS provider_project_id;
ALTER TABLE project_repos DROP COLUMN IF EXISTS provider_base_url;
