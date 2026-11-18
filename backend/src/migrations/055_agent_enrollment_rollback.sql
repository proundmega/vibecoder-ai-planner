-- Rollback for 055_agent_enrollment.sql.
-- Drop the agents columns first, then the child tables (events, refresh,
-- access, enrollment).

ALTER TABLE agents
  DROP COLUMN IF EXISTS last_enrolled_ip,
  DROP COLUMN IF EXISTS node_metadata,
  DROP COLUMN IF EXISTS enrolled_at,
  DROP COLUMN IF EXISTS enrollment_token_id,
  DROP COLUMN IF EXISTS project_id;

DROP TABLE IF EXISTS agent_auth_events;
DROP TABLE IF EXISTS agent_refresh_replays;
DROP TABLE IF EXISTS agent_refresh_tokens;
DROP TABLE IF EXISTS agent_access_tokens;
DROP TABLE IF EXISTS agent_enrollment_tokens;
