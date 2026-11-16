-- Rollback: 051_harness_events.sql
DROP TRIGGER IF EXISTS trg_harness_events_append_only ON harness_events;
DROP FUNCTION IF EXISTS harness_events_append_only();
DROP TABLE IF EXISTS harness_events;
DROP INDEX IF EXISTS idx_harness_runs_project_started;
ALTER TABLE harness_runs DROP COLUMN IF EXISTS project_id;
