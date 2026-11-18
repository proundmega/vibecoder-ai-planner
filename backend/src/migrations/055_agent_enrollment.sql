-- fg-53: agent enrollment and node access tokens.
-- Additive only. Existing ak_ legacy agents are untouched.

CREATE TABLE IF NOT EXISTS agent_enrollment_tokens (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider_id BIGINT REFERENCES providers(id) ON DELETE SET NULL,
  name VARCHAR(100) NOT NULL,
  token_prefix VARCHAR(16) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_enrollment_tokens_uses_check CHECK (used_count <= max_uses)
);

CREATE INDEX IF NOT EXISTS idx_agent_enrollment_tokens_prefix
  ON agent_enrollment_tokens(token_prefix);
CREATE INDEX IF NOT EXISTS idx_agent_enrollment_tokens_project
  ON agent_enrollment_tokens(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_enrollment_tokens_expiry
  ON agent_enrollment_tokens(expires_at) WHERE revoked_at IS NULL;

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

CREATE INDEX IF NOT EXISTS idx_agent_access_tokens_prefix
  ON agent_access_tokens(token_prefix);
CREATE INDEX IF NOT EXISTS idx_agent_access_tokens_agent
  ON agent_access_tokens(agent_id, expires_at DESC);

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

CREATE INDEX IF NOT EXISTS idx_agent_refresh_tokens_prefix
  ON agent_refresh_tokens(token_prefix);
CREATE INDEX IF NOT EXISTS idx_agent_refresh_tokens_agent
  ON agent_refresh_tokens(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_refresh_tokens_family
  ON agent_refresh_tokens(family_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_refresh_tokens_expiry
  ON agent_refresh_tokens(expires_at);

CREATE TABLE IF NOT EXISTS agent_refresh_replays (
  id BIGSERIAL PRIMARY KEY,
  refresh_token_id BIGINT NOT NULL REFERENCES agent_refresh_tokens(id) ON DELETE CASCADE,
  idempotency_key VARCHAR(128) NOT NULL,
  response_ciphertext TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (refresh_token_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_agent_refresh_replays_expiry
  ON agent_refresh_replays(expires_at);

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

CREATE INDEX IF NOT EXISTS idx_agent_auth_events_project
  ON agent_auth_events(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_auth_events_agent
  ON agent_auth_events(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_auth_events_created
  ON agent_auth_events(created_at);

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS enrollment_token_id BIGINT
    REFERENCES agent_enrollment_tokens(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS enrolled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS node_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_enrolled_ip INET;

CREATE INDEX IF NOT EXISTS idx_agents_project_id ON agents(project_id);
