-- 060_ticket_questions_notifications.sql
-- fg-55 human question loop: questions, notifications and the run waiting
-- markers. Additive only; a waiting run keeps status='running' so the active
-- run index, lease and reaper queries are unchanged.

ALTER TABLE harness_runs
  ADD COLUMN IF NOT EXISTS waiting_since TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS waited_ms BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS ticket_questions (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES harness_runs(id) ON DELETE CASCADE,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  runtime_id BIGINT NOT NULL REFERENCES agent_runtimes(id) ON DELETE CASCADE,
  external_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('question', 'permission', 'doom_loop')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'answered', 'expired', 'cancelled')),
  prompt TEXT NOT NULL CHECK (char_length(prompt) <= 8192),
  options JSONB,
  answer TEXT CHECK (answer IS NULL OR char_length(answer) <= 8192),
  answered_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  answered_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_questions_external
  ON ticket_questions(run_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ticket_questions_run_status
  ON ticket_questions(run_id, status);
CREATE INDEX IF NOT EXISTS idx_ticket_questions_project_status
  ON ticket_questions(project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_questions_pending
  ON ticket_questions(created_at DESC) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  ticket_id BIGINT REFERENCES tickets(id) ON DELETE CASCADE,
  run_id UUID REFERENCES harness_runs(id) ON DELETE CASCADE,
  question_id BIGINT REFERENCES ticket_questions(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN
    ('question', 'run_succeeded', 'run_failed', 'budget_exceeded')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);
