-- Rollback: 052_harness_budgets.sql
DROP TRIGGER IF EXISTS trg_harness_kill_switch_audit_append_only
  ON harness_kill_switch_audit;
DROP FUNCTION IF EXISTS harness_kill_switch_audit_append_only();
DROP TABLE IF EXISTS harness_kill_switch_audit;
DROP INDEX IF EXISTS uq_usage_logs_harness_run_model;
DROP TABLE IF EXISTS harness_kill_switches;
DROP TABLE IF EXISTS harness_budget_policies;
DROP TABLE IF EXISTS harness_usage;
DROP TABLE IF EXISTS model_prices;
DROP INDEX IF EXISTS idx_harness_runs_ticket_started;
ALTER TABLE harness_runs DROP COLUMN IF EXISTS artifacts_finalized_at;
ALTER TABLE harness_runs DROP COLUMN IF EXISTS budget_reserved_usd;
