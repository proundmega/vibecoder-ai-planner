-- Rollback: 054_agent_revoke_project_admin.sql
DELETE FROM role_permissions
WHERE role_id = (SELECT id FROM roles WHERE name = 'project_admin')
  AND permission_id = (SELECT id FROM permissions WHERE code = 'AGENT_REVOKE');
