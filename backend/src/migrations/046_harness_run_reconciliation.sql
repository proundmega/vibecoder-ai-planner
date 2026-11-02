-- Migration: 046_harness_run_reconciliation.sql
-- Track terminal harness runs that still need ticket reconciliation (fg-33).

ALTER TABLE harness_runs
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;

-- Only terminal runs are swept. The partial index keeps the reconciliation
-- query cheap even when run history grows.
CREATE INDEX IF NOT EXISTS idx_harness_runs_pending_reconcile
  ON harness_runs(reconciled_at)
  WHERE status <> 'running' AND reconciled_at IS NULL;
