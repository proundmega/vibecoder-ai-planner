-- Rollback: 046_harness_run_reconciliation.sql

DROP INDEX IF EXISTS idx_harness_runs_pending_reconcile;

ALTER TABLE harness_runs
  DROP COLUMN IF EXISTS reconciled_at;
