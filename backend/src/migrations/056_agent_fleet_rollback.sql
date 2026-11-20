-- Rollback for 056_agent_fleet.sql (additive phase).
-- Drops the runtime columns and the new tables; legacy agents/providers and
-- their rows are untouched because this migration never removed them.

ALTER TABLE tickets DROP COLUMN IF EXISTS assigned_runtime_id;
ALTER TABLE agent_actions DROP COLUMN IF EXISTS runtime_id;
ALTER TABLE agent_heartbeats DROP COLUMN IF EXISTS runtime_id;
ALTER TABLE usage_logs DROP COLUMN IF EXISTS runtime_id;
ALTER TABLE telemetry_events DROP COLUMN IF EXISTS runtime_id;
ALTER TABLE harness_runs DROP COLUMN IF EXISTS runtime_id;
ALTER TABLE harness_leases DROP COLUMN IF EXISTS runtime_id;
ALTER TABLE harness_usage DROP COLUMN IF EXISTS runtime_id;
ALTER TABLE repo_profile_validations DROP COLUMN IF EXISTS runtime_id;
ALTER TABLE harness_events DROP COLUMN IF EXISTS runtime_id;

DROP TABLE IF EXISTS agent_node_refresh_replays;
DROP TABLE IF EXISTS agent_node_auth_events;
DROP TABLE IF EXISTS agent_node_refresh_tokens;
DROP TABLE IF EXISTS agent_node_access_tokens;
DROP TABLE IF EXISTS agent_node_enrollment_tokens;
DROP TABLE IF EXISTS agent_runtimes;
DROP TABLE IF EXISTS agent_node_grants;
DROP TABLE IF EXISTS provider_models;
DROP TABLE IF EXISTS provider_credentials;
DROP TABLE IF EXISTS agent_nodes;
