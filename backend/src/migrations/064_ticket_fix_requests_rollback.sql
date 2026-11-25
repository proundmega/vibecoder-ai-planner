-- Rollback for fg-32a fix requests and review/fix cache fields.
DROP TABLE IF EXISTS ticket_fix_requests;

ALTER TABLE projects DROP COLUMN IF EXISTS fix_loop_mode;

ALTER TABLE tickets
  DROP COLUMN IF EXISTS fix_branch,
  DROP COLUMN IF EXISTS reviewed_sha,
  DROP COLUMN IF EXISTS review_round,
  DROP COLUMN IF EXISTS review_state;
