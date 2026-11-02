-- Migration: 046_harness_run_reconciliation.sql
-- Track terminal harness runs that still need ticket reconciliation (fg-33).
--
-- If an earlier draft of this migration was applied to a staging database
-- before the backfill below was added, the column already exists and the DO
-- block will not run. Run the terminal-run UPDATE manually once on that
-- database; fresh databases are backfilled here.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'harness_runs'
      AND column_name = 'reconciled_at'
  ) THEN
    ALTER TABLE harness_runs ADD COLUMN reconciled_at TIMESTAMPTZ;

    -- One-time backfill: the first sweep must not reconcile historical runs
    -- (and potentially release or adopt their old tickets). Only terminal runs
    -- created after this migration stay pending.
    UPDATE harness_runs SET reconciled_at = NOW() WHERE status <> 'running';
  END IF;
END $$;

-- Normalise legacy empty strings so they are not mistaken for PR/head evidence.
UPDATE harness_runs
SET pr_url = NULL
WHERE pr_url IS NOT NULL AND BTRIM(pr_url) = '';

UPDATE harness_runs
SET head_sha = NULL
WHERE head_sha IS NOT NULL AND BTRIM(head_sha) = '';

-- Only terminal runs are swept. The partial index keeps the reconciliation
-- query cheap even when run history grows.
CREATE INDEX IF NOT EXISTS idx_harness_runs_pending_reconcile
  ON harness_runs(reconciled_at)
  WHERE status <> 'running' AND reconciled_at IS NULL;
