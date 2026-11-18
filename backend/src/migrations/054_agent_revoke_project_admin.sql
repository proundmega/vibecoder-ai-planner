-- Project admins create agents, so they must also be able to manage their keys.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'project_admin'
  AND p.code = 'AGENT_REVOKE'
ON CONFLICT DO NOTHING;
