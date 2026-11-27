-- Migration: 067_repo_profile_events.sql
-- Repo profile lifecycle audit events (fg-39 D10).

CREATE TABLE IF NOT EXISTS repo_profile_events (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES repo_profiles(id) ON DELETE SET NULL,
  version INTEGER,
  actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(40) NOT NULL,
  from_status TEXT,
  to_status TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT repo_profile_events_action_check CHECK (
    action IN ('created', 'updated', 'activated', 'reactivated', 'retired')
  )
);

CREATE INDEX IF NOT EXISTS idx_repo_profile_events_project_created
  ON repo_profile_events(project_id, created_at DESC, id DESC);
