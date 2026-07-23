ALTER TABLE ticket_planning DROP COLUMN IF EXISTS last_tokens_in;
ALTER TABLE ticket_planning DROP COLUMN IF EXISTS last_tokens_out;
ALTER TABLE ticket_planning DROP COLUMN IF EXISTS last_cost_usd;
ALTER TABLE ticket_planning DROP COLUMN IF EXISTS last_duration_ms;
ALTER TABLE ticket_planning DROP COLUMN IF EXISTS last_provider_type;
ALTER TABLE ticket_planning DROP COLUMN IF EXISTS last_model;
ALTER TABLE ticket_planning DROP COLUMN IF EXISTS last_planning_stage;
ALTER TABLE ticket_planning DROP COLUMN IF EXISTS last_ai_call_at;
DROP INDEX IF EXISTS idx_ticket_planning_last_ai_call;

ALTER TABLE usage_logs DROP COLUMN IF EXISTS planning_stage;
ALTER TABLE usage_logs DROP COLUMN IF EXISTS file_key;
DROP INDEX IF EXISTS idx_usage_logs_planning_stage;
DROP INDEX IF EXISTS idx_usage_logs_file_key;
