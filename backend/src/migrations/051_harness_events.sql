-- Migration: 051_harness_events.sql
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
  event_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT harness_events_version_check CHECK (version > 0),
  CONSTRAINT harness_events_type_check CHECK (length(type) BETWEEN 1 AND 120)
);

-- Tenant-scoped reads lead with project_id; run and ticket lookups are the
-- operator/debug paths. Audit events share the same append-only store.
CREATE INDEX IF NOT EXISTS idx_harness_events_project_created
  ON harness_events(project_id, event_timestamp DESC, event_id);
CREATE INDEX IF NOT EXISTS idx_harness_events_run_created
  ON harness_events(run_id, event_timestamp ASC, event_id);
CREATE INDEX IF NOT EXISTS idx_harness_events_ticket_created
  ON harness_events(ticket_id, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_harness_events_trace
  ON harness_events(trace_id, event_timestamp ASC);
CREATE INDEX IF NOT EXISTS idx_harness_events_type_created
  ON harness_events(type, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_harness_events_created_at
  ON harness_events(type, created_at DESC);
-- Dashboard/alert predicates use GREATEST(event_timestamp, created_at) so a
-- backdated event cannot be hidden from the current window.
CREATE INDEX IF NOT EXISTS idx_harness_events_project_alert_time
  ON harness_events(project_id, GREATEST(event_timestamp, created_at) DESC);
CREATE INDEX IF NOT EXISTS idx_harness_events_payload
  ON harness_events USING GIN (payload jsonb_path_ops);

-- Event correlation needs the ticket's project on the run itself. This is
-- applied before 051 on fresh installs and is idempotent when 051 runs later.
ALTER TABLE harness_runs
  ADD COLUMN IF NOT EXISTS project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL;

UPDATE harness_runs r
SET project_id = t.project_id
FROM tickets t
WHERE t.id = r.ticket_id
  AND r.project_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_harness_runs_project_started
  ON harness_runs(project_id, started_at DESC);

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
