-- Migration: 050_harness_events.sql
-- Append-only structured harness event store (fg-41 slice 1).
-- Events are emitted by the supervisor, redacted at emission and again at
-- ingest, and correlated by trace/run/ticket/project/agent.

CREATE TABLE IF NOT EXISTS harness_events (
  event_id UUID PRIMARY KEY,
  trace_id UUID NOT NULL,
  -- No foreign keys: an append-only timeline must survive parent deletion and
  -- must never be rewritten by cascade actions. Ids remain as historical
  -- references; tenant scoping still uses project_id.
  run_id UUID,
  ticket_id BIGINT,
  project_id BIGINT NOT NULL,
  agent_id BIGINT,
  session_id TEXT,
  type TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT harness_events_version_check CHECK (version > 0),
  CONSTRAINT harness_events_type_check CHECK (length(type) BETWEEN 1 AND 120)
);

-- Tenant-scoped reads lead with project_id; run and ticket lookups are the
-- operator/debug paths. Audit events share the same append-only store.
CREATE INDEX IF NOT EXISTS idx_harness_events_project_created
  ON harness_events(project_id, created_at DESC, event_id);
CREATE INDEX IF NOT EXISTS idx_harness_events_run_created
  ON harness_events(run_id, created_at ASC, event_id);
CREATE INDEX IF NOT EXISTS idx_harness_events_ticket_created
  ON harness_events(ticket_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_harness_events_trace
  ON harness_events(trace_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_harness_events_type_created
  ON harness_events(type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_harness_events_payload
  ON harness_events USING GIN (payload jsonb_path_ops);

-- Append-only enforcement. Retention is the only delete path and must opt in
-- inside its own transaction, so a bug or a compromised API cannot rewrite or
-- erase history silently.
CREATE OR REPLACE FUNCTION harness_events_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'harness_events is append-only';
  END IF;
  IF TG_OP = 'DELETE'
     AND current_setting('harness.allow_event_purge', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'harness_events rows may only be removed by retention';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_harness_events_append_only ON harness_events;
CREATE TRIGGER trg_harness_events_append_only
  BEFORE UPDATE OR DELETE ON harness_events
  FOR EACH ROW EXECUTE FUNCTION harness_events_append_only();

COMMENT ON TABLE harness_events IS
  'Append-only harness event stream (fg-41). Retention deletes are gated by harness.allow_event_purge.';
