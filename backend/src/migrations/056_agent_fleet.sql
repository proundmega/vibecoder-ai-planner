-- Migration: 056_agent_fleet.sql
-- fg-54 phase 1 (ADDITIVE): node/grant/runtime identity and the provider
-- registry. Legacy agents/providers/token tables stay in place so the current
-- control plane keeps working until the joint clean-cut migration.
--
-- The destructive cut (drop agents/providers/fg-53 tables, rename legacy
-- columns) lives in 057_agent_fleet_clean_cut.sql and is NOT registered until
-- Track A slices 3-4 and Track B are ready to land together.

CREATE TABLE IF NOT EXISTS agent_nodes (
  id BIGSERIAL PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  hostname VARCHAR(255),
  fingerprint VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','draining','revoked')),
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_nodes_owner_name_key UNIQUE (owner_id, name)
);

CREATE TABLE IF NOT EXISTS agent_node_grants (
  id BIGSERIAL PRIMARY KEY,
  node_id BIGINT NOT NULL REFERENCES agent_nodes(id) ON DELETE CASCADE,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('worker','reviewer','planner')),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_node_grants_active
  ON agent_node_grants(node_id, project_id, role)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_agent_node_grants_project
  ON agent_node_grants(project_id, role) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS provider_credentials (
  id BIGSERIAL PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  provider_type VARCHAR(50) NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  base_url TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','disabled')),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT provider_credentials_owner_scope_name_key
    UNIQUE NULLS NOT DISTINCT (owner_id, project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_provider_credentials_scope
  ON provider_credentials(owner_id, project_id);

CREATE TABLE IF NOT EXISTS provider_models (
  id BIGSERIAL PRIMARY KEY,
  credential_id BIGINT NOT NULL REFERENCES provider_credentials(id) ON DELETE RESTRICT,
  model VARCHAR(200) NOT NULL,
  display_name VARCHAR(200),
  source VARCHAR(20) NOT NULL CHECK (source IN ('discovered','manual')),
  status VARCHAR(20) NOT NULL DEFAULT 'unverified'
    CHECK (status IN ('unverified','verified','disabled')),
  roles TEXT[] NOT NULL DEFAULT '{}'
    CHECK (roles <@ ARRAY['worker','reviewer','planner']::TEXT[]),
  max_tokens INTEGER CHECK (max_tokens IS NULL OR max_tokens > 0),
  context_window INTEGER CHECK (context_window IS NULL OR context_window > 0),
  effort VARCHAR(20) NOT NULL DEFAULT 'medium'
    CHECK (effort IN ('minimal','low','medium','high','max')),
  last_verified_at TIMESTAMPTZ,
  last_verify_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT provider_models_credential_model_key UNIQUE (credential_id, model)
);

CREATE TABLE IF NOT EXISTS agent_runtimes (
  id BIGSERIAL PRIMARY KEY,
  node_id BIGINT NOT NULL REFERENCES agent_nodes(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('worker','reviewer','planner')),
  model_id BIGINT NOT NULL REFERENCES provider_models(id) ON DELETE RESTRICT,
  concurrency INTEGER NOT NULL DEFAULT 1 CHECK (concurrency > 0),
  effort VARCHAR(20)
    CHECK (effort IS NULL OR effort IN ('minimal','low','medium','high','max')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','draining','stopped')),
  current_project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_runtimes_node_name_key UNIQUE (node_id, name)
);

CREATE INDEX IF NOT EXISTS idx_agent_runtimes_node
  ON agent_runtimes(node_id, status);

CREATE TABLE IF NOT EXISTS agent_node_enrollment_tokens (
  id BIGSERIAL PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  token_prefix VARCHAR(16) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_node_enrollment_tokens_uses_check CHECK (used_count <= max_uses)
);

CREATE INDEX IF NOT EXISTS idx_agent_node_enrollment_tokens_prefix
  ON agent_node_enrollment_tokens(token_prefix);
CREATE INDEX IF NOT EXISTS idx_agent_node_enrollment_tokens_owner
  ON agent_node_enrollment_tokens(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_node_enrollment_tokens_expiry
  ON agent_node_enrollment_tokens(expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS agent_node_access_tokens (
  id BIGSERIAL PRIMARY KEY,
  node_id BIGINT NOT NULL REFERENCES agent_nodes(id) ON DELETE CASCADE,
  token_prefix VARCHAR(16) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_node_access_tokens_prefix
  ON agent_node_access_tokens(token_prefix);
CREATE INDEX IF NOT EXISTS idx_agent_node_access_tokens_node
  ON agent_node_access_tokens(node_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_node_access_tokens_expiry
  ON agent_node_access_tokens(expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS agent_node_refresh_tokens (
  id BIGSERIAL PRIMARY KEY,
  node_id BIGINT NOT NULL REFERENCES agent_nodes(id) ON DELETE CASCADE,
  token_prefix VARCHAR(16) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  family_id UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  rotated_at TIMESTAMPTZ,
  replaced_by_id BIGINT REFERENCES agent_node_refresh_tokens(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_node_refresh_tokens_prefix
  ON agent_node_refresh_tokens(token_prefix);
CREATE INDEX IF NOT EXISTS idx_agent_node_refresh_tokens_node
  ON agent_node_refresh_tokens(node_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_node_refresh_tokens_family
  ON agent_node_refresh_tokens(family_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_node_refresh_tokens_expiry
  ON agent_node_refresh_tokens(expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS agent_node_refresh_replays (
  id BIGSERIAL PRIMARY KEY,
  refresh_token_id BIGINT NOT NULL REFERENCES agent_node_refresh_tokens(id) ON DELETE CASCADE,
  idempotency_key VARCHAR(128) NOT NULL,
  response_ciphertext TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_node_refresh_replays_key UNIQUE (refresh_token_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_agent_node_refresh_replays_expiry
  ON agent_node_refresh_replays(expires_at);

CREATE TABLE IF NOT EXISTS agent_node_auth_events (
  id BIGSERIAL PRIMARY KEY,
  node_id BIGINT REFERENCES agent_nodes(id) ON DELETE SET NULL,
  project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
  event_type VARCHAR(50) NOT NULL,
  actor_type VARCHAR(16) NOT NULL DEFAULT 'system',
  actor_id VARCHAR(64),
  ip_address INET,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_node_auth_events_node
  ON agent_node_auth_events(node_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_node_auth_events_created
  ON agent_node_auth_events(created_at);

-- New runtime columns beside the legacy agent columns (dual-read/write until
-- the joint cut). No legacy value is renamed, reset or dropped here.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assigned_runtime_id BIGINT
  REFERENCES agent_runtimes(id) ON DELETE SET NULL;
ALTER TABLE agent_actions ADD COLUMN IF NOT EXISTS runtime_id BIGINT
  REFERENCES agent_runtimes(id) ON DELETE SET NULL;
ALTER TABLE agent_heartbeats ADD COLUMN IF NOT EXISTS runtime_id BIGINT
  REFERENCES agent_runtimes(id) ON DELETE CASCADE;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS runtime_id BIGINT
  REFERENCES agent_runtimes(id) ON DELETE SET NULL;
ALTER TABLE telemetry_events ADD COLUMN IF NOT EXISTS runtime_id BIGINT
  REFERENCES agent_runtimes(id) ON DELETE SET NULL;
ALTER TABLE harness_runs ADD COLUMN IF NOT EXISTS runtime_id BIGINT
  REFERENCES agent_runtimes(id) ON DELETE CASCADE;
ALTER TABLE harness_leases ADD COLUMN IF NOT EXISTS runtime_id BIGINT
  REFERENCES agent_runtimes(id) ON DELETE CASCADE;
ALTER TABLE harness_usage ADD COLUMN IF NOT EXISTS runtime_id BIGINT
  REFERENCES agent_runtimes(id) ON DELETE SET NULL;
ALTER TABLE repo_profile_validations ADD COLUMN IF NOT EXISTS runtime_id BIGINT
  REFERENCES agent_runtimes(id) ON DELETE SET NULL;

-- Append-only: new events carry runtime_id; historical agent_id is untouched.
ALTER TABLE harness_events ADD COLUMN IF NOT EXISTS runtime_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_tickets_assigned_runtime
  ON tickets(assigned_runtime_id) WHERE assigned_runtime_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_harness_runs_runtime_status
  ON harness_runs(runtime_id, status) WHERE runtime_id IS NOT NULL;
