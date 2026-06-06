-- Migration 003: Role System Overhaul
-- Date: 2026-06-05
-- Purpose: Add new role system, approval workflow, and account lifecycle

-- ==================== NEW COLUMNS ====================

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_created_by BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- ==================== UPDATE ROLE CONSTRAINT ====================

ALTER TABLE users DROP CONSTRAINT IF EXISTS valid_roles;
ALTER TABLE users ADD CONSTRAINT valid_roles 
  CHECK (role IN ('super_admin', 'project_admin', 'member', 'user'));

-- ==================== MIGRATE EXISTING DATA ====================

-- Migrate 'admin' and 'ADMIN' to 'project_admin'
UPDATE users SET role = 'project_admin' WHERE role IN ('admin', 'ADMIN');

-- Migrate existing 'member'/'MEMBER' to 'project_admin' (if any)
UPDATE users SET role = 'project_admin' WHERE role IN ('member', 'MEMBER');

-- ==================== APPROVAL REQUESTS TABLE ====================

CREATE TABLE IF NOT EXISTS approval_requests (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT REFERENCES tickets(id) ON DELETE CASCADE,
  requested_by BIGINT REFERENCES users(id),
  approved_by BIGINT REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  approved_at TIMESTAMP,
  CONSTRAINT valid_approval_status CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_ticket_id ON approval_requests(ticket_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status);
