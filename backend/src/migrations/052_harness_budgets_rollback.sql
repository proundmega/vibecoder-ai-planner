-- Rollback: 052_harness_budgets.sql
DROP INDEX IF EXISTS uq_usage_logs_harness_run_model;
DROP TABLE IF EXISTS harness_kill_switches;
DROP TABLE IF EXISTS harness_budget_policies;
DROP TABLE IF EXISTS harness_usage;
DROP TABLE IF EXISTS model_prices;
DROP INDEX IF EXISTS idx_harness_runs_ticket_started;
