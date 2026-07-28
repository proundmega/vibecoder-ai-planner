-- Migration: 040_telemetry_events.sql
-- Structured telemetry events with three-layer canonical payload

CREATE TABLE IF NOT EXISTS telemetry_events (
  id BIGSERIAL PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1,
  content_hash VARCHAR(64) NOT NULL,
  provider_type VARCHAR(50) NOT NULL,
  model VARCHAR(100) NOT NULL,
  raw_provider_fields JSONB NOT NULL DEFAULT '{}',
  normalized_fields JSONB NOT NULL DEFAULT '{}',
  derived_metrics JSONB NOT NULL DEFAULT '{}',
  field_provenance JSONB NOT NULL DEFAULT '{}',
  project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
  user_id BIGINT REFERENCES users(id),
  agent_id BIGINT REFERENCES agents(id) ON DELETE SET NULL,
  ticket_id BIGINT REFERENCES tickets(id),
  planning_stage VARCHAR(50),
  file_key VARCHAR(100),
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(content_hash)
);

CREATE INDEX IF NOT EXISTS idx_telemetry_events_content_hash ON telemetry_events(content_hash);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_provider_model ON telemetry_events(provider_type, model);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_project_id ON telemetry_events(project_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_created_at ON telemetry_events(created_at);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_agent_id ON telemetry_events(agent_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_ticket_id ON telemetry_events(ticket_id);
