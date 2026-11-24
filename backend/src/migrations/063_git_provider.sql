-- Migration: 063_git_provider.sql
-- Provider-neutral repository metadata (fg-57).
--
-- `061` is already used by the ticket-readiness slice, so the Git provider
-- columns live in 062. Existing GitHub rows keep working: provider stays
-- `github`, auth_mode defaults to `app`, and the existing encrypted token slot
-- is unchanged.

ALTER TABLE project_repos
  ADD COLUMN IF NOT EXISTS provider_base_url TEXT,
  ADD COLUMN IF NOT EXISTS provider_project_id TEXT,
  ADD COLUMN IF NOT EXISTS auth_mode VARCHAR(20) NOT NULL DEFAULT 'app',
  ADD COLUMN IF NOT EXISTS ssh_key_encrypted TEXT;

ALTER TABLE project_repos DROP CONSTRAINT IF EXISTS valid_provider;
ALTER TABLE project_repos
  ADD CONSTRAINT valid_provider
  CHECK (provider IN ('github', 'forgejo', 'gitea', 'gitlab', 'local'));

ALTER TABLE project_repos DROP CONSTRAINT IF EXISTS valid_auth_mode;
ALTER TABLE project_repos
  ADD CONSTRAINT valid_auth_mode
  CHECK (auth_mode IN ('app', 'pat', 'project_token', 'ssh', 'none'));

UPDATE project_repos SET provider = 'github' WHERE provider IS NULL;
