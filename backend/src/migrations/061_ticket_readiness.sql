-- 061_ticket_readiness.sql
-- fg-45 ticket quality gates and Definition of Ready.
-- Additive: approval/ready/small-fix/override state on tickets, acceptance
-- criteria, an append-only readiness audit, and the two readiness permissions.
-- Existing in-progress/review/done tickets are grandfathered in this migration
-- so rollout cannot freeze work that is already moving.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS plan_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS plan_approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ready_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS small_fix_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS small_fix_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS small_fix_reason TEXT,
  ADD COLUMN IF NOT EXISTS readiness_override_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS readiness_override_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS readiness_override_reason TEXT,
  ADD COLUMN IF NOT EXISTS readiness_waived_codes TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS readiness_override_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS readiness_grandfathered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS readiness_requirement_ids TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS ticket_acceptance_criteria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  text TEXT NOT NULL CHECK (char_length(text) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ticket_readiness_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  action VARCHAR(32) NOT NULL CHECK (action IN (
    'approved', 'approval_invalidated', 'replan_started', 'small_fix',
    'override_granted', 'override_revoked', 'override_expired', 'blocked'
  )),
  attempt_id UUID UNIQUE,
  actor_type VARCHAR(16) NOT NULL CHECK (actor_type IN ('user', 'agent', 'system')),
  actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  -- No FK: the legacy agents table is dropped by the fg-54 clean cut (057),
  -- which runs after this migration. The id is a historical reference.
  actor_agent_id BIGINT,
  actor_role VARCHAR(32),
  reason TEXT,
  waived_codes TEXT[] NOT NULL DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  before_state JSONB,
  after_state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_readiness_events_ticket
  ON ticket_readiness_events(ticket_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_readiness_events_action
  ON ticket_readiness_events(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_acceptance_ticket
  ON ticket_acceptance_criteria(ticket_id, position);

-- Grandfather every ticket that is already past backlog. A grandfathered row
-- skips the gate entirely; its approval/ready facts are written so existing
-- UI reads and the legacy phase gate keep working.
UPDATE tickets
SET readiness_grandfathered_at = COALESCE(updated_at, NOW()),
    ready_at = COALESCE(ready_at, updated_at, NOW()),
    plan_approved_at = COALESCE(plan_approved_at, updated_at, NOW()),
    planning_status = CASE
      WHEN planning_status IS NULL OR planning_status <> 'completed' THEN 'completed'
      ELSE planning_status
    END
WHERE status IN ('in_progress', 'review', 'done')
  AND readiness_grandfathered_at IS NULL;

INSERT INTO permissions (code, description) VALUES
  ('TICKET_READINESS_APPROVE', 'Approve a ticket plan for execution (readiness)'),
  ('TICKET_READINESS_OVERRIDE', 'Grant, revoke or record readiness exceptions')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name IN ('project_admin', 'super_admin')
  AND p.code IN ('TICKET_READINESS_APPROVE', 'TICKET_READINESS_OVERRIDE')
ON CONFLICT DO NOTHING;
