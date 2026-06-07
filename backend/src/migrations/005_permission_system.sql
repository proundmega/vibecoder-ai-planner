-- PA-01: Permission-Based Access Control System
-- Creates permissions, roles, and role_permissions tables
-- Replaces inline role checks with database-driven permission mapping

-- 1. Permissions table: defines all available permissions
CREATE TABLE IF NOT EXISTS permissions (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Roles table: defines all roles and their display names
CREATE TABLE IF NOT EXISTS roles (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  display_name VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Role-Permission mapping: many-to-many relationship
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id BIGINT REFERENCES roles(id) ON DELETE CASCADE,
  permission_id BIGINT REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- Indexes for fast permission lookup
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id ON role_permissions(permission_id);

-- 4. Seed permissions
INSERT INTO permissions (code, description) VALUES
  ('TICKET_CREATE',       'Create new tickets'),
  ('TICKET_READ',         'Read/view tickets'),
  ('TICKET_UPDATE',       'Update ticket fields'),
  ('TICKET_DELETE',       'Delete tickets'),
  ('TICKET_STATUS_CHANGE','Change ticket status'),
  ('TICKET_COMMENT',      'Add comments to tickets'),
  ('PROJECT_CREATE',      'Create new projects'),
  ('PROJECT_READ',        'View projects'),
  ('PROJECT_UPDATE',      'Update project details'),
  ('PROJECT_DELETE',      'Delete projects'),
  ('PROJECT_MANAGE_MEMBERS', 'Add/remove project members'),
  ('USER_CREATE',         'Create user accounts'),
  ('USER_READ',           'View user accounts'),
  ('USER_UPDATE',         'Update user details'),
  ('USER_DELETE',         'Delete user accounts'),
  ('USER_TOGGLE_ACTIVE',  'Activate/deactivate users'),
  ('USER_VIEW_ALL',       'View all users (platform-wide)'),
  ('AGENT_CREATE',        'Create AI agents'),
  ('AGENT_READ',          'View AI agents'),
  ('AGENT_REVOKE',        'Revoke agent API key'),
  ('AGENT_DELETE',        'Delete AI agents'),
  ('APPROVAL_APPROVE',    'Approve tickets'),
  ('APPROVAL_REJECT',     'Reject tickets'),
  ('APPROVAL_VIEW',       'View approval requests'),
  ('PRICING_READ',        'View pricing info'),
  ('DASHBOARD_READ',      'Access dashboard')
ON CONFLICT (code) DO NOTHING;

-- 5. Seed roles
INSERT INTO roles (name, description, display_name) VALUES
  ('super_admin',   'Full platform access, view all users, manage everything', 'Super Admin'),
  ('project_admin', 'Full project control: manage tickets, AI keys, create members', 'Project Admin'),
  ('member',        'Team lead/reviewer: manage tickets, review work, create users', 'Member'),
  ('user',          'AI agent: create/update own tickets, read AI tokens', 'AI Agent')
ON CONFLICT (name) DO NOTHING;

-- 6. Map super_admin -> ALL permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'super_admin'
ON CONFLICT DO NOTHING;

-- 7. Map project_admin -> project + ticket + agent + user management permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'project_admin'
  AND p.code IN (
    'TICKET_CREATE', 'TICKET_READ', 'TICKET_UPDATE', 'TICKET_DELETE', 'TICKET_STATUS_CHANGE', 'TICKET_COMMENT',
    'PROJECT_CREATE', 'PROJECT_READ', 'PROJECT_UPDATE', 'PROJECT_DELETE', 'PROJECT_MANAGE_MEMBERS',
    'USER_CREATE', 'USER_READ', 'USER_TOGGLE_ACTIVE', 'USER_DELETE',
    'AGENT_CREATE', 'AGENT_READ', 'AGENT_DELETE',
    'APPROVAL_APPROVE', 'APPROVAL_REJECT',
    'PRICING_READ', 'DASHBOARD_READ'
  )
ON CONFLICT DO NOTHING;

-- 8. Map member -> team collaboration permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'member'
  AND p.code IN (
    'TICKET_CREATE', 'TICKET_READ', 'TICKET_UPDATE', 'TICKET_DELETE', 'TICKET_STATUS_CHANGE', 'TICKET_COMMENT',
    'PROJECT_READ',
    'USER_CREATE', 'USER_READ',
    'APPROVAL_APPROVE', 'APPROVAL_REJECT',
    'AGENT_READ',
    'PRICING_READ', 'DASHBOARD_READ'
  )
ON CONFLICT DO NOTHING;

-- 9. Map user -> AI agent permissions (minimal)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'user'
  AND p.code IN (
    'TICKET_CREATE', 'TICKET_READ', 'TICKET_UPDATE', 'TICKET_STATUS_CHANGE', 'TICKET_COMMENT',
    'PROJECT_READ',
    'AGENT_READ',
    'PRICING_READ', 'DASHBOARD_READ'
  )
ON CONFLICT DO NOTHING;
