-- bp-115: Add CSP_READ and CSP_DELETE permissions
-- CSP_READ: View CSP violations (granted to project_admin, super_admin)
-- CSP_DELETE: Delete CSP violations (granted to super_admin only)

INSERT INTO permissions (code, description)
VALUES 
  ('CSP_READ', 'View CSP violations'),
  ('CSP_DELETE', 'Delete CSP violations')
ON CONFLICT (code) DO NOTHING;

-- Update role_permissions: project_admin gets CSP_READ
INSERT INTO role_permissions (role_id, permission_id)
SELECT 
  (SELECT id FROM roles WHERE name = 'project_admin'),
  (SELECT id FROM permissions WHERE code = 'CSP_READ')
WHERE NOT EXISTS (
  SELECT 1 FROM role_permissions rp
  JOIN roles r ON rp.role_id = r.id
  JOIN permissions p ON rp.permission_id = p.id
  WHERE r.name = 'project_admin' AND p.code = 'CSP_READ'
);

-- super_admin gets both CSP_READ and CSP_DELETE
INSERT INTO role_permissions (role_id, permission_id)
SELECT 
  (SELECT id FROM roles WHERE name = 'super_admin'),
  (SELECT id FROM permissions WHERE code = 'CSP_READ')
WHERE NOT EXISTS (
  SELECT 1 FROM role_permissions rp
  JOIN roles r ON rp.role_id = r.id
  JOIN permissions p ON rp.permission_id = p.id
  WHERE r.name = 'super_admin' AND p.code = 'CSP_READ'
);

INSERT INTO role_permissions (role_id, permission_id)
SELECT 
  (SELECT id FROM roles WHERE name = 'super_admin'),
  (SELECT id FROM permissions WHERE code = 'CSP_DELETE')
WHERE NOT EXISTS (
  SELECT 1 FROM role_permissions rp
  JOIN roles r ON rp.role_id = r.id
  JOIN permissions p ON rp.permission_id = p.id
  WHERE r.name = 'super_admin' AND p.code = 'CSP_DELETE'
);
