-- Provider registry audit events (fg-54 control plane).
CREATE TABLE IF NOT EXISTS provider_registry_events (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
  credential_id BIGINT REFERENCES provider_credentials(id) ON DELETE SET NULL,
  model_id BIGINT REFERENCES provider_models(id) ON DELETE SET NULL,
  actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  event_type VARCHAR(60) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_registry_events_created
  ON provider_registry_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_registry_events_credential
  ON provider_registry_events(credential_id, created_at DESC);
