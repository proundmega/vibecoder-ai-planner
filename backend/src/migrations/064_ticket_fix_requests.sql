-- fg-32a: structured fix requests and review/fix cache fields.
-- Additive only. fg-32 owns claim/lease/round/escalation writes.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS review_state TEXT NOT NULL DEFAULT 'none'
    CHECK (review_state IN
      ('none', 'awaiting_review', 'changes_requested', 'fixing', 'fix_failed', 'escalated')),
  ADD COLUMN IF NOT EXISTS review_round INT NOT NULL DEFAULT 0
    CHECK (review_round >= 0),
  ADD COLUMN IF NOT EXISTS reviewed_sha TEXT
    CHECK (reviewed_sha IS NULL OR reviewed_sha ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
  ADD COLUMN IF NOT EXISTS fix_branch VARCHAR(255);

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS fix_loop_mode TEXT NOT NULL DEFAULT 'off'
    CHECK (fix_loop_mode IN ('off', 'manual', 'auto'));

CREATE TABLE IF NOT EXISTS ticket_fix_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  attempt_id UUID REFERENCES ticket_review_attempts(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('reviewer', 'human')),
  branch TEXT NOT NULL CHECK (char_length(branch) > 0),
  reviewed_sha TEXT NOT NULL
    CHECK (reviewed_sha ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
  state TEXT NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'claimed', 'fixing', 'completed', 'failed', 'escalated')),
  feedback TEXT,
  -- fg-32b1 claims store agent_runtimes.id, matching harness_runs.runtime_id.
  claimed_by BIGINT REFERENCES agent_runtimes(id) ON DELETE SET NULL,
  lease_expires_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Reviewer requests are idempotent per review attempt.
  UNIQUE (attempt_id)
);

-- At most one active fix request per ticket.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fix_request_active
  ON ticket_fix_requests (ticket_id)
  WHERE state IN ('queued', 'claimed', 'fixing');

CREATE INDEX IF NOT EXISTS idx_fix_requests_ticket
  ON ticket_fix_requests (ticket_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fix_requests_queue
  ON ticket_fix_requests (state, next_attempt_at);
