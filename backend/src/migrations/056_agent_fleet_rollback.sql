-- Rollback for 056_agent_fleet.sql.
-- Restores the legacy schema (empty tables); the clean cut does not preserve
-- identity, provider-secret or runtime data.

-- Append-only column added by 056.
ALTER TABLE harness_events DROP COLUMN IF EXISTS runtime_id;

-- New FKs on legacy columns first.
ALTER TABLE agent_actions DROP CONSTRAINT IF EXISTS agent_actions_runtime_id_fkey;
ALTER TABLE agent_heartbeats DROP CONSTRAINT IF EXISTS agent_heartbeats_runtime_id_fkey;
ALTER TABLE usage_logs DROP CONSTRAINT IF EXISTS usage_logs_runtime_id_fkey;
ALTER TABLE telemetry_events DROP CONSTRAINT IF EXISTS telemetry_events_runtime_id_fkey;
ALTER TABLE harness_runs DROP CONSTRAINT IF EXISTS harness_runs_runtime_id_fkey;
ALTER TABLE harness_leases DROP CONSTRAINT IF EXISTS harness_leases_runtime_id_fkey;
ALTER TABLE harness_usage DROP CONSTRAINT IF EXISTS harness_usage_runtime_id_fkey;
ALTER TABLE repo_profile_validations DROP CONSTRAINT IF EXISTS repo_profile_validations_runtime_id_fkey;
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_assigned_runtime_id_runtime_fkey;

-- Columns back to their legacy names.
ALTER TABLE agent_actions RENAME COLUMN runtime_id TO agent_id;
ALTER TABLE agent_heartbeats RENAME COLUMN runtime_id TO agent_id;
ALTER TABLE usage_logs RENAME COLUMN runtime_id TO agent_id;
ALTER TABLE telemetry_events RENAME COLUMN runtime_id TO agent_id;
ALTER TABLE harness_runs RENAME COLUMN runtime_id TO agent_id;
ALTER TABLE harness_leases RENAME COLUMN runtime_id TO agent_id;
ALTER TABLE harness_usage RENAME COLUMN runtime_id TO agent_id;
ALTER TABLE repo_profile_validations RENAME COLUMN runtime_id TO agent_id;
ALTER TABLE tickets RENAME COLUMN assigned_runtime_id TO assigned_agent_id;

-- Drop the new schema child-first.
DROP TABLE IF EXISTS agent_node_refresh_replays;
DROP TABLE IF EXISTS agent_node_auth_events;
DROP TABLE IF EXISTS agent_node_refresh_tokens;
DROP TABLE IF EXISTS agent_node_access_tokens;
DROP TABLE IF EXISTS agent_node_enrollment_tokens;
DROP TABLE IF EXISTS agent_runtimes;
DROP TABLE IF EXISTS agent_node_grants;
DROP TABLE IF EXISTS provider_models;
DROP TABLE IF EXISTS provider_credentials;
DROP TABLE IF EXISTS agent_nodes;

-- Recreate legacy provider tables (empty).
CREATE TABLE IF NOT EXISTS providers (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  provider_type VARCHAR(50) NOT NULL DEFAULT 'claude',
  api_key_encrypted TEXT,
  base_url TEXT,
  model VARCHAR(100) NOT NULL,
  roles TEXT[] NOT NULL DEFAULT ARRAY['worker'],
  max_tokens INTEGER DEFAULT 4096,
  temperature DECIMAL(3,2) DEFAULT 0.1,
  endpoint_url VARCHAR(512),
  fallback_provider VARCHAR(32),
  routing_rules JSONB DEFAULT '{}',
  is_project_director BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  project_id BIGINT REFERENCES projects(id),
  CONSTRAINT unique_provider_name_type UNIQUE (name, provider_type)
);
CREATE INDEX IF NOT EXISTS idx_providers_type ON providers(provider_type);
CREATE INDEX IF NOT EXISTS idx_providers_project_id ON providers(project_id);

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
  endpoint_url VARCHAR(512),
  fallback_provider VARCHAR(32),
  routing_rules JSONB DEFAULT '{}',
  is_project_director BOOLEAN DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_project_providers_project_id ON project_providers(project_id);
CREATE INDEX IF NOT EXISTS idx_project_providers_is_active ON project_providers(is_active);

-- Recreate the empty legacy agent table (055 columns added below).
CREATE TABLE IF NOT EXISTS agents (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  api_key TEXT UNIQUE,
  owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rate_limit INTEGER DEFAULT 100,
  max_actions_per_day INTEGER DEFAULT 1000,
  current_daily_usage INTEGER DEFAULT 0,
  last_reset_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  api_key_expires_at TIMESTAMP WITH TIME ZONE,
  api_key_hash TEXT,
  api_key_hash_prefix TEXT,
  provider_id BIGINT REFERENCES providers(id) ON DELETE SET NULL,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMPTZ,
  node_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_enrolled_ip INET
);
CREATE INDEX IF NOT EXISTS idx_agents_api_key ON agents(api_key);
CREATE INDEX IF NOT EXISTS idx_agents_owner_id ON agents(owner_id);
CREATE INDEX IF NOT EXISTS idx_agents_provider_id ON agents(provider_id);
CREATE INDEX IF NOT EXISTS idx_agents_project_id ON agents(project_id);

-- fg-53 enrollment/token tables, child-first on the way down; here parent first.
CREATE TABLE IF NOT EXISTS agent_enrollment_tokens (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider_id BIGINT REFERENCES providers(id) ON DELETE SET NULL,
  name VARCHAR(100) NOT NULL,
  token_prefix VARCHAR(16) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_enrollment_tokens_uses_check CHECK (used_count <= max_uses)
);

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS enrollment_token_id BIGINT
    REFERENCES agent_enrollment_tokens(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS agent_access_tokens (
  id BIGSERIAL PRIMARY KEY,
  agent_id BIGINT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  token_prefix VARCHAR(16) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_refresh_tokens (
  id BIGSERIAL PRIMARY KEY,
  agent_id BIGINT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  token_prefix VARCHAR(16) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  family_id UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  rotated_at TIMESTAMPTZ,
  replaced_by_id BIGINT REFERENCES agent_refresh_tokens(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_refresh_replays (
  id BIGSERIAL PRIMARY KEY,
  refresh_token_id BIGINT NOT NULL REFERENCES agent_refresh_tokens(id) ON DELETE CASCADE,
  idempotency_key VARCHAR(128) NOT NULL,
  response_ciphertext TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (refresh_token_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS agent_auth_events (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
  agent_id BIGINT REFERENCES agents(id) ON DELETE SET NULL,
  event_type VARCHAR(50) NOT NULL,
  actor_type VARCHAR(16) NOT NULL DEFAULT 'system',
  actor_id VARCHAR(64),
  ip_address INET,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Restore the legacy FKs.
ALTER TABLE agent_actions
  ADD CONSTRAINT agent_actions_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE;
ALTER TABLE agent_heartbeats
  ADD CONSTRAINT agent_heartbeats_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE;
ALTER TABLE usage_logs
  ADD CONSTRAINT usage_logs_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL;
ALTER TABLE telemetry_events
  ADD CONSTRAINT telemetry_events_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL;
ALTER TABLE harness_runs
  ADD CONSTRAINT harness_runs_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE;
ALTER TABLE harness_leases
  ADD CONSTRAINT harness_leases_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE;
ALTER TABLE harness_usage
  ADD CONSTRAINT harness_usage_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL;
ALTER TABLE repo_profile_validations
  ADD CONSTRAINT repo_profile_validations_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL;
ALTER TABLE tickets
  ADD CONSTRAINT tickets_assigned_agent_id_agent_fkey
  FOREIGN KEY (assigned_agent_id) REFERENCES agents(id) ON DELETE SET NULL;

-- 048 released tickets when an agent was deleted; the function survives the
-- table drop, so only the trigger needs recreating.
CREATE OR REPLACE FUNCTION release_agent_tickets_on_delete() RETURNS TRIGGER AS $$
BEGIN
  UPDATE tickets
  SET assigned_agent_id = NULL,
      locked_at = NULL,
      status = CASE WHEN status = 'in_progress' THEN 'backlog' ELSE status END
  WHERE assigned_agent_id = OLD.id;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS release_agent_tickets_on_delete ON agents;
CREATE TRIGGER release_agent_tickets_on_delete
BEFORE DELETE ON agents
FOR EACH ROW EXECUTE FUNCTION release_agent_tickets_on_delete();
