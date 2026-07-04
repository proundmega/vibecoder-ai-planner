CREATE TABLE IF NOT EXISTS compute_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname VARCHAR(256) NOT NULL,
  ssh_port INTEGER DEFAULT 22,
  ssh_user VARCHAR(64) NOT NULL,
  ssh_key_credential_id BIGINT NOT NULL REFERENCES project_credentials(id),
  labels JSONB DEFAULT '{}',
  capacity INTEGER DEFAULT 1 NOT NULL CHECK (capacity > 0),
  status VARCHAR(16) DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'draining', 'degraded')),
  failure_count INTEGER DEFAULT 0,
  last_seen TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(hostname)
);

CREATE INDEX IF NOT EXISTS idx_compute_nodes_status ON compute_nodes(status);

COMMENT ON TABLE compute_nodes IS 'Remote Docker hosts for agent provisioning via SSH';
