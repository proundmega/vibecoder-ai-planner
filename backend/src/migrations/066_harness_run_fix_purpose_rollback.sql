-- Rollback: 066_harness_run_fix_purpose.sql

DROP INDEX IF EXISTS idx_harness_runs_fix_request;

ALTER TABLE harness_runs
  DROP CONSTRAINT IF EXISTS harness_runs_fix_request_check;

ALTER TABLE harness_runs
  DROP COLUMN IF EXISTS fix_request_id,
  DROP COLUMN IF EXISTS purpose;
