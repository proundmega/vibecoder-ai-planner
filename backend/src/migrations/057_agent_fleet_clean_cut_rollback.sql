-- Rollback for 057_agent_fleet_clean_cut.sql.
-- Restores the empty legacy schema (columns + tables). Data is intentionally
-- lost by the clean cut. Run 056_agent_fleet_rollback.sql afterwards to remove
-- the additive runtime columns.
--
-- The rollback is manual and is not tracked by schema_migrations. Delete the
-- 057 row (and any rows for later files) before the next db:migrate if the
-- clean cut must be applied again.

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

CREATE TABLE IF NOT EXISTS agents (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  api_key TEXT UNIQUE,
  owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rate_limit INTEGER DEFAULT 100,
  max_actions_per_day INTEGER DEFAULT 1000,
  current_daily_usage INTEGER DEFAULT 0,
  last_reset_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  api_key_expires_at TIMESTAMPTZ,
  api_key_hash TEXT,
  api_key_hash_prefix TEXT,
  provider_id BIGINT REFERENCES providers(id) ON DELETE SET NULL,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMPTZ,
  node_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_enrolled_ip INET
);

CREATE TABLE IF NOT EXISTS agent_enrollment_tokens (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider_id BIGINT REFERENCES providers(id) ON DELETE SET NULL,
  name VARCHAR(100) NOT NULL,
  token_prefix VARCHAR(16) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS enrollment_token_id BIGINT
    REFERENCES agent_enrollment_tokens(id) ON DELETE SET NULL;

ALTER TABLE agent_enrollment_tokens
  ADD CONSTRAINT agent_enrollment_tokens_uses_check CHECK (used_count <= max_uses);

CREATE INDEX IF NOT EXISTS idx_agents_api_key ON agents(api_key);
CREATE INDEX IF NOT EXISTS idx_agents_owner_id ON agents(owner_id);
CREATE INDEX IF NOT EXISTS idx_agents_provider_id ON agents(provider_id);
CREATE INDEX IF NOT EXISTS idx_agents_project_id ON agents(project_id);
CREATE INDEX IF NOT EXISTS idx_providers_type ON providers(provider_type);
CREATE INDEX IF NOT EXISTS idx_providers_project_id ON providers(project_id);
CREATE INDEX IF NOT EXISTS idx_project_providers_project_id ON project_providers(project_id);
CREATE INDEX IF NOT EXISTS idx_project_providers_is_active ON project_providers(is_active);

CREATE TABLE IF NOT EXISTS agent_access_tokens (
  id BIGSERIAL PRIMARY KEY,
  agent_id BIGINT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  token_prefix VARCHAR(16) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_refresh_tokens (
  id BIGSERIAL PRIMARY KEY,
  agent_id BIGINT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  token_prefix VARCHAR(16) NOT NULL,
  token_hash CHAR(64) NOT NULL,
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

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assigned_agent_id BIGINT
  REFERENCES agents(id) ON DELETE SET NULL;
ALTER TABLE agent_actions ADD COLUMN IF NOT EXISTS agent_id BIGINT
  REFERENCES agents(id) ON DELETE CASCADE;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS agent_id BIGINT
  REFERENCES agents(id) ON DELETE SET NULL;
ALTER TABLE telemetry_events ADD COLUMN IF NOT EXISTS agent_id BIGINT
  REFERENCES agents(id) ON DELETE SET NULL;
ALTER TABLE harness_runs ADD COLUMN IF NOT EXISTS agent_id BIGINT
  REFERENCES agents(id) ON DELETE CASCADE;
ALTER TABLE harness_leases ADD COLUMN IF NOT EXISTS agent_id BIGINT
  REFERENCES agents(id) ON DELETE CASCADE;
-- Legacy schema required these; rows that only ever carried a runtime id are
-- dropped by the clean-cut rollback (data loss is accepted).
DELETE FROM harness_runs WHERE agent_id IS NULL;
DELETE FROM harness_leases WHERE agent_id IS NULL;
ALTER TABLE harness_runs ALTER COLUMN agent_id SET NOT NULL;
ALTER TABLE harness_leases ALTER COLUMN agent_id SET NOT NULL;
ALTER TABLE harness_usage ADD COLUMN IF NOT EXISTS agent_id BIGINT
  REFERENCES agents(id) ON DELETE SET NULL;
ALTER TABLE repo_profile_validations ADD COLUMN IF NOT EXISTS agent_id BIGINT
  REFERENCES agents(id) ON DELETE SET NULL;
ALTER TABLE harness_events ADD COLUMN IF NOT EXISTS agent_id BIGINT;

-- The legacy heartbeat used agent_id as its primary key.
ALTER TABLE agent_heartbeats DROP CONSTRAINT IF EXISTS agent_heartbeats_pkey;
ALTER TABLE agent_heartbeats
  ADD COLUMN IF NOT EXISTS agent_id BIGINT REFERENCES agents(id) ON DELETE CASCADE;
DELETE FROM agent_heartbeats WHERE agent_id IS NULL;
ALTER TABLE agent_heartbeats ADD CONSTRAINT agent_heartbeats_pkey PRIMARY KEY (agent_id);

-- Legacy token-table indexes and checks.
CREATE INDEX IF NOT EXISTS idx_agent_access_tokens_prefix ON agent_access_tokens(token_prefix);
CREATE INDEX IF NOT EXISTS idx_agent_access_tokens_agent ON agent_access_tokens(agent_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_access_tokens_expiry ON agent_access_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_agent_refresh_tokens_prefix ON agent_refresh_tokens(token_prefix);
CREATE INDEX IF NOT EXISTS idx_agent_refresh_tokens_agent ON agent_refresh_tokens(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_refresh_tokens_family ON agent_refresh_tokens(family_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_refresh_tokens_expiry ON agent_refresh_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_agent_enrollment_tokens_prefix ON agent_enrollment_tokens(token_prefix);
CREATE INDEX IF NOT EXISTS idx_agent_enrollment_tokens_project ON agent_enrollment_tokens(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_enrollment_tokens_expiry ON agent_enrollment_tokens(expires_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agent_refresh_replays_expiry ON agent_refresh_replays(expires_at);
CREATE INDEX IF NOT EXISTS idx_agent_auth_events_project ON agent_auth_events(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_auth_events_agent ON agent_auth_events(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_auth_events_created ON agent_auth_events(created_at);

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
