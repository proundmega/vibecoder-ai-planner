-- 061_ticket_readiness_rollback.sql
-- Removes the fg-45 readiness schema, permissions and state columns.
-- Order: dependent tables, permission grants, permissions, ticket columns.

DROP TABLE IF EXISTS ticket_readiness_events;
DROP TABLE IF EXISTS ticket_acceptance_criteria;

DELETE FROM role_permissions
WHERE permission_id IN (
  SELECT id FROM permissions
  WHERE code IN ('TICKET_READINESS_APPROVE', 'TICKET_READINESS_OVERRIDE')
);

DELETE FROM permissions
WHERE code IN ('TICKET_READINESS_APPROVE', 'TICKET_READINESS_OVERRIDE');

ALTER TABLE tickets
  DROP COLUMN IF EXISTS readiness_requirement_ids,
  DROP COLUMN IF EXISTS readiness_grandfathered_at,
  DROP COLUMN IF EXISTS readiness_override_expires_at,
  DROP COLUMN IF EXISTS readiness_waived_codes,
  DROP COLUMN IF EXISTS readiness_override_reason,
  DROP COLUMN IF EXISTS readiness_override_by,
  DROP COLUMN IF EXISTS readiness_override_at,
  DROP COLUMN IF EXISTS small_fix_reason,
  DROP COLUMN IF EXISTS small_fix_by,
  DROP COLUMN IF EXISTS small_fix_at,
  DROP COLUMN IF EXISTS ready_by,
  DROP COLUMN IF EXISTS ready_at,
  DROP COLUMN IF EXISTS plan_approved_by,
  DROP COLUMN IF EXISTS plan_approved_at;
