-- Migration: 050_repo_profiles.sql
-- Versioned repository environment profiles and dry-run validations (fg-39).

CREATE TABLE IF NOT EXISTS repo_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  profile JSONB NOT NULL,
  profile_hash TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  CONSTRAINT repo_profiles_status_check CHECK (
    status IN ('draft', 'active', 'inactive')
  ),
  CONSTRAINT repo_profiles_version_check CHECK (version > 0),
  UNIQUE (project_id, version)
);

CREATE INDEX IF NOT EXISTS idx_repo_profiles_project_id
  ON repo_profiles(project_id, created_at DESC);

-- At most one active profile per project. Activation flips the previous row
-- to inactive in the same transaction.
CREATE UNIQUE INDEX IF NOT EXISTS uq_repo_profiles_active
  ON repo_profiles(project_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS repo_profile_validations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES repo_profiles(id) ON DELETE CASCADE,
  profile_version INTEGER NOT NULL,
  profile JSONB NOT NULL,
  profile_hash TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  requested_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  agent_id BIGINT REFERENCES agents(id) ON DELETE SET NULL,
  result JSONB NOT NULL DEFAULT '{}',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  CONSTRAINT repo_profile_validations_status_check CHECK (
    status IN ('queued', 'running', 'succeeded', 'failed')
  ),
  CONSTRAINT repo_profile_validations_version_check CHECK (profile_version > 0)
);

-- The migration was extended during review; keep it idempotent for databases
-- that applied an earlier draft before this branch merged. These ALTERs must
-- run before any index that references profile_hash.
ALTER TABLE repo_profiles
  ADD COLUMN IF NOT EXISTS profile_hash TEXT;
ALTER TABLE repo_profile_validations
  ADD COLUMN IF NOT EXISTS profile_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_repo_profile_validations_project_status
  ON repo_profile_validations(project_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_repo_profile_validations_profile_hash
  ON repo_profile_validations(profile_id, profile_hash, status);


-- Do not queue the same profile revision twice while one is queued/running.
CREATE UNIQUE INDEX IF NOT EXISTS uq_repo_profile_validations_pending
  ON repo_profile_validations(profile_id)
  WHERE status IN ('queued', 'running');

-- Record which profile revision a durable harness run used.
ALTER TABLE harness_runs
  ADD COLUMN IF NOT EXISTS repo_profile_id UUID
    REFERENCES repo_profiles(id) ON DELETE SET NULL;

ALTER TABLE harness_runs
  ADD COLUMN IF NOT EXISTS repo_profile_version INTEGER;
