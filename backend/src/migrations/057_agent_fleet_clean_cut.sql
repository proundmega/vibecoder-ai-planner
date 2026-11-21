-- 057_agent_fleet_clean_cut.sql
-- Registered after 059. Removes the legacy agent/provider/auth schema.
--
-- 056 already added runtime_id/assigned_runtime_id beside the legacy columns.
-- This migration drops the legacy columns and tables; it never renames a
-- column, so it cannot collide with 056.
--
-- harness_events stays append-only: historical agent_id is left in place and
-- runtime_id remains the column for new events.

ALTER TABLE agent_actions DROP CONSTRAINT IF EXISTS agent_actions_agent_id_fkey;
ALTER TABLE agent_heartbeats DROP CONSTRAINT IF EXISTS agent_heartbeats_agent_id_fkey;
ALTER TABLE usage_logs DROP CONSTRAINT IF EXISTS usage_logs_agent_id_fkey;
ALTER TABLE telemetry_events DROP CONSTRAINT IF EXISTS telemetry_events_agent_id_fkey;
ALTER TABLE harness_runs DROP CONSTRAINT IF EXISTS harness_runs_agent_id_fkey;
ALTER TABLE harness_leases DROP CONSTRAINT IF EXISTS harness_leases_agent_id_fkey;
ALTER TABLE harness_usage DROP CONSTRAINT IF EXISTS harness_usage_agent_id_fkey;
ALTER TABLE repo_profile_validations DROP CONSTRAINT IF EXISTS repo_profile_validations_agent_id_fkey;
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_assigned_agent_id_agent_fkey;
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_enrollment_token_id_fkey;

-- Rows that only exist for a legacy identity cannot be carried over.
DELETE FROM harness_leases WHERE runtime_id IS NULL;
DELETE FROM harness_runs WHERE runtime_id IS NULL;
DELETE FROM agent_heartbeats WHERE runtime_id IS NULL;

ALTER TABLE tickets DROP COLUMN IF EXISTS assigned_agent_id;
ALTER TABLE agent_actions DROP COLUMN IF EXISTS agent_id;
ALTER TABLE usage_logs DROP COLUMN IF EXISTS agent_id;
ALTER TABLE telemetry_events DROP COLUMN IF EXISTS agent_id;
ALTER TABLE harness_usage DROP COLUMN IF EXISTS agent_id;
ALTER TABLE repo_profile_validations DROP COLUMN IF EXISTS agent_id;
ALTER TABLE agent_heartbeats DROP COLUMN IF EXISTS agent_id;

-- The legacy heartbeat PK moved with its column; make runtime_id the key.
ALTER TABLE agent_heartbeats DROP CONSTRAINT IF EXISTS agent_heartbeats_pkey;
ALTER TABLE agent_heartbeats ALTER COLUMN runtime_id SET NOT NULL;
ALTER TABLE agent_heartbeats ADD CONSTRAINT agent_heartbeats_pkey PRIMARY KEY (runtime_id);

ALTER TABLE harness_runs DROP COLUMN IF EXISTS agent_id;
ALTER TABLE harness_runs ALTER COLUMN runtime_id SET NOT NULL;
ALTER TABLE harness_leases DROP COLUMN IF EXISTS agent_id;
ALTER TABLE harness_leases ALTER COLUMN runtime_id SET NOT NULL;

DROP TABLE IF EXISTS agent_refresh_replays;
DROP TABLE IF EXISTS agent_auth_events;
DROP TABLE IF EXISTS agent_refresh_tokens;
DROP TABLE IF EXISTS agent_access_tokens;
DROP TABLE IF EXISTS agent_enrollment_tokens;

DROP TABLE IF EXISTS agents;
DROP TABLE IF EXISTS project_providers;
DROP TABLE IF EXISTS providers;
DROP FUNCTION IF EXISTS release_agent_tickets_on_delete();
