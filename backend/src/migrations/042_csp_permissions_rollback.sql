-- bp-115: Rollback - Remove CSP_READ and CSP_DELETE permissions
-- This rollback removes the permissions and role assignments added in 042_csp_permissions.sql

-- Drop role_permissions entries first (foreign key constraint)
DELETE FROM role_permissions
WHERE permission_id IN (
  SELECT id FROM permissions WHERE code IN ('CSP_READ', 'CSP_DELETE')
);

-- Drop the permissions
DELETE FROM permissions
WHERE code IN ('CSP_READ', 'CSP_DELETE');
