-- Rollback: 050_harness_events.sql
DROP TRIGGER IF EXISTS trg_harness_events_append_only ON harness_events;
DROP FUNCTION IF EXISTS harness_events_append_only();
DROP TABLE IF EXISTS harness_events;
