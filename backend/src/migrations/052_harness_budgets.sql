-- Migration: 052_harness_budgets.sql
-- Harness budgets, routing policies, usage attribution, model prices and
-- kill switches (fg-38). The harness_runs.project_id column is owned by 051.

CREATE INDEX IF NOT EXISTS idx_harness_runs_ticket_started
  ON harness_runs(ticket_id, started_at DESC);

-- Quota reservation and durable artifact finalization (fg-38/41). A run holds
-- its remaining potential spend while active; the reaper clears it on finish.
ALTER TABLE harness_runs
  ADD COLUMN IF NOT EXISTS budget_reserved_usd NUMERIC(12, 6) NOT NULL DEFAULT 0;
ALTER TABLE harness_runs
  ADD COLUMN IF NOT EXISTS artifacts_finalized_at TIMESTAMPTZ;

-- Versioned price table. Rows are append-only by convention: a price change is
-- a new effective_from row, never an update of history.
CREATE TABLE IF NOT EXISTS model_prices (
  id BIGSERIAL PRIMARY KEY,
  model TEXT NOT NULL,
  input_per_million NUMERIC(12, 6) NOT NULL DEFAULT 0,
  output_per_million NUMERIC(12, 6) NOT NULL DEFAULT 0,
  cached_per_million NUMERIC(12, 6) NOT NULL DEFAULT 0,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT model_prices_non_negative CHECK (
    input_per_million >= 0
    AND output_per_million >= 0
    AND cached_per_million >= 0
  ),
  CONSTRAINT model_prices_model_effective_key UNIQUE (model, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_model_prices_model_effective
  ON model_prices(model, effective_from DESC);

INSERT INTO model_prices
  (model, input_per_million, output_per_million, cached_per_million, effective_from)
VALUES
  ('beam-free', 0, 0, 0, TIMESTAMPTZ '2026-01-01T00:00:00Z'),
  ('free', 0, 0, 0, TIMESTAMPTZ '2026-01-01T00:00:00Z'),
  ('claude-sonnet-4-20250514', 3, 15, 0.3, TIMESTAMPTZ '2026-01-01T00:00:00Z'),
  ('claude-3-haiku-20240307', 0.8, 4, 0.08, TIMESTAMPTZ '2026-01-01T00:00:00Z'),
  ('gpt-4o', 2.5, 10, 1.25, TIMESTAMPTZ '2026-01-01T00:00:00Z'),
  ('gpt-4o-mini', 0.15, 0.6, 0.075, TIMESTAMPTZ '2026-01-01T00:00:00Z'),
  ('default', 1, 3, 0, TIMESTAMPTZ '2026-01-01T00:00:00Z')
ON CONFLICT (model, effective_from) DO NOTHING;

-- Cumulative per-run/per-model usage. The agent reports snapshots and the
-- upsert keeps the greatest value, so a crash or a retried report cannot lose
-- or double-count usage. Rows are linked to ticket/run/project/agent for
-- billing and attribution.
CREATE TABLE IF NOT EXISTS harness_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES harness_runs(id) ON DELETE SET NULL,
  ticket_id BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
  project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
  agent_id BIGINT REFERENCES agents(id) ON DELETE SET NULL,
  model TEXT NOT NULL,
  prompt_version TEXT,
  config_hash TEXT,
  routing_reason TEXT,
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  cached_tokens BIGINT NOT NULL DEFAULT 0,
  cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  duration_ms BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT harness_usage_non_negative CHECK (
    input_tokens >= 0 AND output_tokens >= 0 AND cached_tokens >= 0
    AND cost_usd >= 0 AND tool_calls >= 0 AND duration_ms >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_harness_usage_run_model
  ON harness_usage(run_id, model) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_harness_usage_project_created
  ON harness_usage(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_harness_usage_ticket
  ON harness_usage(ticket_id);
CREATE INDEX IF NOT EXISTS idx_harness_usage_agent
  ON harness_usage(agent_id, created_at DESC);

-- One billing row per harness run/model. The flush from harness_usage is
-- idempotent; this index is the database backstop.
CREATE UNIQUE INDEX IF NOT EXISTS uq_usage_logs_harness_run_model
  ON usage_logs ((metadata->>'run_id'), model)
  WHERE request_type = 'harness';

-- Project budget/routing policy. One row per project by default; scope and
-- scope_id allow a ticket or agent override without changing the table.
CREATE TABLE IF NOT EXISTS harness_budget_policies (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'project',
  scope_id BIGINT,
  max_duration_seconds INTEGER,
  max_input_tokens BIGINT,
  max_output_tokens BIGINT,
  max_cost_usd NUMERIC(12, 6),
  max_tool_calls INTEGER,
  max_retries INTEGER,
  daily_cost_usd NUMERIC(12, 6),
  project_max_concurrent_runs INTEGER,
  agent_max_concurrent_runs INTEGER,
  warn_ratio NUMERIC(4, 3) NOT NULL DEFAULT 0.8,
  routing_policy TEXT NOT NULL DEFAULT 'free_then_paid',
  free_model TEXT,
  paid_model TEXT,
  complexity_threshold INTEGER NOT NULL DEFAULT 3,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT harness_budget_policies_scope_check
    CHECK (scope IN ('project', 'ticket', 'agent')),
  CONSTRAINT harness_budget_policies_scope_id_check
    CHECK ((scope = 'project' AND scope_id IS NULL) OR (scope <> 'project' AND scope_id IS NOT NULL)),
  CONSTRAINT harness_budget_policies_routing_check
    CHECK (routing_policy IN ('free_only', 'free_then_paid', 'paid_for_complex', 'paid_only')),
  CONSTRAINT harness_budget_policies_warn_ratio_check
    CHECK (warn_ratio > 0 AND warn_ratio <= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_harness_budget_policies_project_scope
  ON harness_budget_policies(project_id, scope, COALESCE(scope_id, 0));

-- Kill switch: one global row, one row per project. Enabled rows block new
-- runs and withdraw leases from active runs (the agent then fails closed
-- before publishing).
CREATE TABLE IF NOT EXISTS harness_kill_switches (
  id BIGSERIAL PRIMARY KEY,
  scope TEXT NOT NULL,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  reason TEXT,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT harness_kill_switches_scope_check
    CHECK (scope IN ('global', 'project')),
  CONSTRAINT harness_kill_switches_scope_project_check
    CHECK ((scope = 'global' AND project_id IS NULL) OR (scope = 'project' AND project_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_harness_kill_switches_scope_project
  ON harness_kill_switches(scope, COALESCE(project_id, 0));

-- Immutable kill-switch history. The current switch row is mutable, but every
-- toggle is appended here with actor and reason.
CREATE TABLE IF NOT EXISTS harness_kill_switch_audit (
  id BIGSERIAL PRIMARY KEY,
  scope TEXT NOT NULL,
  project_id BIGINT,
  enabled BOOLEAN NOT NULL,
  reason TEXT,
  actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT harness_kill_switch_audit_scope_check
    CHECK (scope IN ('global', 'project'))
);

CREATE INDEX IF NOT EXISTS idx_harness_kill_switch_audit_created
  ON harness_kill_switch_audit(scope, project_id, created_at DESC);

CREATE OR REPLACE FUNCTION harness_kill_switch_audit_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_harness_kill_switch_audit_append_only
  ON harness_kill_switch_audit;
CREATE TRIGGER trg_harness_kill_switch_audit_append_only
  BEFORE UPDATE OR DELETE ON harness_kill_switch_audit
  FOR EACH ROW EXECUTE FUNCTION harness_kill_switch_audit_append_only();

COMMENT ON TABLE harness_usage IS 'Per-run/model token and cost attribution (fg-38).';
COMMENT ON TABLE harness_budget_policies IS 'Per-project harness budget and routing policy (fg-38).';
COMMENT ON TABLE harness_kill_switches IS 'Global/project harness kill switches (fg-38).';
COMMENT ON TABLE harness_kill_switch_audit IS 'Append-only kill-switch history (fg-38).';
COMMENT ON TABLE model_prices IS 'Versioned per-million model prices (fg-38).';
