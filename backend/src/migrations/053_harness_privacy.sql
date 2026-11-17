-- Migration: 053_harness_privacy.sql
-- Harness privacy and data-governance policy (fg-42).

CREATE TABLE IF NOT EXISTS harness_privacy_policies (
  project_id BIGINT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  max_data_class TEXT NOT NULL DEFAULT 'confidential',
  allowed_providers TEXT[] NOT NULL DEFAULT '{}',
  require_no_training BOOLEAN NOT NULL DEFAULT FALSE,
  local_only BOOLEAN NOT NULL DEFAULT FALSE,
  local_endpoint TEXT,
  local_model TEXT,
  data_residency TEXT,
  block_on_secret BOOLEAN NOT NULL DEFAULT FALSE,
  block_on_pii BOOLEAN NOT NULL DEFAULT FALSE,
  redact_pii BOOLEAN NOT NULL DEFAULT TRUE,
  event_retention_days INTEGER NOT NULL DEFAULT 30,
  artifact_retention_days INTEGER NOT NULL DEFAULT 7,
  policy_version INTEGER NOT NULL DEFAULT 1,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT harness_privacy_policies_class_check
    CHECK (max_data_class IN ('public', 'internal', 'confidential', 'secret')),
  CONSTRAINT harness_privacy_policies_event_retention_check
    CHECK (event_retention_days BETWEEN 1 AND 3650),
  CONSTRAINT harness_privacy_policies_artifact_retention_check
    CHECK (artifact_retention_days BETWEEN 1 AND 3650),
  CONSTRAINT harness_privacy_policies_version_check CHECK (policy_version > 0)
);

COMMENT ON TABLE harness_privacy_policies IS
  'Per-project harness data classification, provider, retention and redaction policy (fg-42).';

-- Provider metadata used for the policy decision is persisted with the run so
-- an operator can audit later which endpoint/region the agent claimed.
ALTER TABLE harness_runs
  ADD COLUMN IF NOT EXISTS provider_base_url TEXT;
ALTER TABLE harness_runs
  ADD COLUMN IF NOT EXISTS provider_region TEXT;

CREATE INDEX IF NOT EXISTS idx_harness_privacy_policies_updated
  ON harness_privacy_policies(updated_at DESC);
