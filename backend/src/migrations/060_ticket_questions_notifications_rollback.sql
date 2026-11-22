-- Rollback: 060_ticket_questions_notifications.sql
-- Notifications and questions are additive; dropping them loses no other data.
-- The waiting columns are safe to drop once no run is suspended.

DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS ticket_questions;

ALTER TABLE harness_runs
  DROP COLUMN IF EXISTS waiting_since,
  DROP COLUMN IF EXISTS waited_ms;
