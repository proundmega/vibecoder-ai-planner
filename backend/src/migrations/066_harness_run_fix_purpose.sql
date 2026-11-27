-- Migration: 066_harness_run_fix_purpose.sql
-- fg-32c2: a fixer harness run is an explicit run purpose tied to a claimed
-- fix request. Build runs keep the fg-33 publish-evidence guard; fix runs are
-- authorised by the claim instead.

ALTER TABLE harness_runs
  ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'build'
    CHECK (purpose IN ('build', 'fix')),
  -- CASCADE matches harness_runs.ticket_id: a fix run has no meaning without
  -- its request, and SET NULL would violate the check below (and block the
  -- ticket_review_attempts -> ticket_fix_requests cascade).
  ADD COLUMN IF NOT EXISTS fix_request_id UUID
    REFERENCES ticket_fix_requests(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'harness_runs_fix_request_check'
  ) THEN
    ALTER TABLE harness_runs
      ADD CONSTRAINT harness_runs_fix_request_check CHECK (
        (purpose = 'build' AND fix_request_id IS NULL)
        OR (purpose = 'fix' AND fix_request_id IS NOT NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_harness_runs_fix_request
  ON harness_runs(fix_request_id) WHERE fix_request_id IS NOT NULL;
