-- Migration: 045_harness_runs.sql
-- Durable harness execution: persisted runs, checkpoints and ticket leases (fg-33)

CREATE TABLE IF NOT EXISTS harness_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  agent_id BIGINT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  branch TEXT NOT NULL,
  base_sha TEXT,
  head_sha TEXT,
  pr_url TEXT,
  workspace_path TEXT,
  session_id TEXT,
  provider TEXT,
  model TEXT,
  step TEXT NOT NULL DEFAULT 'created',
  status TEXT NOT NULL DEFAULT 'running',
  attempt INTEGER NOT NULL DEFAULT 1,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  error TEXT,
  CONSTRAINT harness_runs_status_check CHECK (
    status IN ('running', 'succeeded', 'failed', 'dead_letter', 'budget_exceeded')
  ),
  CONSTRAINT harness_runs_attempt_check CHECK (attempt > 0)
);

CREATE INDEX IF NOT EXISTS idx_harness_runs_ticket_id ON harness_runs(ticket_id);
CREATE INDEX IF NOT EXISTS idx_harness_runs_agent_status ON harness_runs(agent_id, status);
CREATE INDEX IF NOT EXISTS idx_harness_runs_status_heartbeat ON harness_runs(status, heartbeat_at);

CREATE TABLE IF NOT EXISTS harness_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES harness_runs(id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_harness_checkpoints_run_id ON harness_checkpoints(run_id, created_at);

CREATE TABLE IF NOT EXISTS harness_leases (
  ticket_id BIGINT PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES harness_runs(id) ON DELETE CASCADE,
  agent_id BIGINT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_harness_leases_expires_at ON harness_leases(expires_at);
CREATE INDEX IF NOT EXISTS idx_harness_leases_agent_id ON harness_leases(agent_id);
