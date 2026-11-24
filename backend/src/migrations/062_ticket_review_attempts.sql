-- fg-31a: review attempts and structured findings.
-- Additive only. fg-31 owns these writes; fg-32 consumes findings and rounds.

CREATE TABLE IF NOT EXISTS ticket_review_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  reviewed_sha TEXT NOT NULL CHECK (char_length(reviewed_sha) > 0),
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  round INT NOT NULL DEFAULT 0 CHECK (round >= 0),
  verdict TEXT CHECK (verdict IN ('approve', 'request_changes', 'comment')),
  verification JSONB,
  github_review_id BIGINT,
  provider TEXT,
  model TEXT,
  tokens_in INT CHECK (tokens_in IS NULL OR tokens_in >= 0),
  tokens_out INT CHECK (tokens_out IS NULL OR tokens_out >= 0),
  duration_ms INT CHECK (duration_ms IS NULL OR duration_ms >= 0),
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Only completed reviews are idempotent; failed/stale attempts may be retried.
CREATE UNIQUE INDEX IF NOT EXISTS uq_review_attempt_completed
  ON ticket_review_attempts (ticket_id, reviewed_sha)
  WHERE status = 'completed';
CREATE INDEX IF NOT EXISTS idx_review_attempts_ticket
  ON ticket_review_attempts (ticket_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_attempts_started
  ON ticket_review_attempts (status, created_at)
  WHERE status = 'started';

CREATE TABLE IF NOT EXISTS ticket_review_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES ticket_review_attempts(id) ON DELETE CASCADE,
  finding_key TEXT NOT NULL CHECK (char_length(finding_key) > 0),
  severity TEXT NOT NULL CHECK (char_length(severity) > 0),
  file TEXT,
  line INT CHECK (line IS NULL OR line > 0),
  message TEXT NOT NULL CHECK (char_length(message) > 0),
  suggestion TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (attempt_id, finding_key)
);

CREATE INDEX IF NOT EXISTS idx_review_findings_attempt
  ON ticket_review_findings (attempt_id, severity);
