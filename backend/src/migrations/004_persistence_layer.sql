-- BA-5: Persistence Layer Improvements
-- Adds soft delete, indexes, and triggers for updated_at timestamps

-- 1. Add soft delete column to tickets
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- 2. Add soft delete column to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- 3. Add soft delete column to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- 3.5. Create project_memberships table (used by ProjectService for team collaboration)
CREATE TABLE IF NOT EXISTS project_memberships (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'member',
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, user_id)
);

-- 4. Create indexes for frequently queried columns
CREATE INDEX IF NOT EXISTS idx_tickets_project_id ON tickets(project_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_owner_id ON tickets(owner_id);
CREATE INDEX IF NOT EXISTS idx_tickets_deleted_at ON tickets(deleted_at) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_deleted_at ON projects(deleted_at) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_project_memberships_project_id ON project_memberships(project_id);
CREATE INDEX IF NOT EXISTS idx_project_memberships_user_id ON project_memberships(user_id);

-- 5. Create updated_at trigger function
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. Attach trigger to tickets
DROP TRIGGER IF EXISTS set_tickets_updated_at ON tickets;
CREATE TRIGGER set_tickets_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- 7. Attach trigger to projects
DROP TRIGGER IF EXISTS set_projects_updated_at ON projects;
CREATE TRIGGER set_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- 8. Attach trigger to users
DROP TRIGGER IF EXISTS set_users_updated_at ON users;
CREATE TRIGGER set_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- 9. Add soft delete check constraint to tickets
ALTER TABLE tickets ADD CONSTRAINT chk_tickets_deleted_at CHECK (
  (status = 'done' AND deleted_at IS NOT NULL) OR deleted_at IS NULL
);

-- 10. Add soft delete check constraint to projects
ALTER TABLE projects ADD CONSTRAINT chk_projects_deleted_at CHECK (
  deleted_at IS NULL OR deleted_at IS NOT NULL
);
