-- Migration: 047_harness_checkpoint_publish_evidence.sql
-- Backfill run-level publish evidence from checkpoints written before
-- recordCheckpoint started copying headSha/prUrl (fg-33).

UPDATE harness_runs
SET head_sha = NULL
WHERE head_sha IS NOT NULL AND BTRIM(head_sha) = '';

UPDATE harness_runs
SET pr_url = NULL
WHERE pr_url IS NOT NULL AND BTRIM(pr_url) = '';

WITH evidence AS (
  SELECT DISTINCT ON (run_id)
         run_id,
         NULLIF(BTRIM(payload->>'headSha'), '') AS head_sha,
         NULLIF(BTRIM(payload->>'prUrl'), '') AS pr_url
  FROM harness_checkpoints
  WHERE NULLIF(BTRIM(payload->>'headSha'), '') IS NOT NULL
     OR NULLIF(BTRIM(payload->>'prUrl'), '') IS NOT NULL
  ORDER BY run_id, created_at DESC, id DESC
)
UPDATE harness_runs r
SET head_sha = COALESCE(r.head_sha, e.head_sha),
    pr_url = COALESCE(r.pr_url, e.pr_url),
    reconciled_at = NULL
FROM evidence e
WHERE r.id = e.run_id
  AND (
    (r.head_sha IS NULL AND e.head_sha IS NOT NULL)
    OR (r.pr_url IS NULL AND e.pr_url IS NOT NULL)
  );
