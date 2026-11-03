-- Rollback: 047_harness_checkpoint_publish_evidence.sql
--
-- This migration only backfills run-level columns from existing checkpoint
-- payloads. There is no safe automatic rollback: DELETE/ALTER of that evidence
-- could make published work releasable again, so no schema or data is reverted.

SELECT 1;
