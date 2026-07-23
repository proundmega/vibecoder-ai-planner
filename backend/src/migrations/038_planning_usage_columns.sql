-- Add last-known usage to ticket_planning (the "planning object itself")
ALTER TABLE ticket_planning
  ADD COLUMN IF NOT EXISTS last_tokens_in INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_tokens_out INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_cost_usd NUMERIC(12,6) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_duration_ms INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_provider_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS last_model VARCHAR(100),
  ADD COLUMN IF NOT EXISTS last_planning_stage VARCHAR(50),
  ADD COLUMN IF NOT EXISTS last_ai_call_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_ticket_planning_last_ai_call
  ON ticket_planning(ticket_id, last_ai_call_at DESC);

-- Add planning context to usage_logs
ALTER TABLE usage_logs
  ADD COLUMN IF NOT EXISTS planning_stage VARCHAR(50),
  ADD COLUMN IF NOT EXISTS file_key VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_usage_logs_planning_stage
  ON usage_logs(ticket_id, planning_stage);
CREATE INDEX IF NOT EXISTS idx_usage_logs_file_key
  ON usage_logs(ticket_id, file_key);
