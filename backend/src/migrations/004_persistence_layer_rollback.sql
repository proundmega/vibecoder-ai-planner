-- Rollback: 004_persistence_layer.sql
-- Reverts persistence layer changes
-- WARNING: Soft delete data may be lost

ALTER TABLE tickets DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE projects DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE users DROP COLUMN IF EXISTS deleted_at;
DROP TRIGGER IF EXISTS set_updated_at ON tickets;
DROP TRIGGER IF EXISTS set_updated_at ON projects;
DROP TRIGGER IF EXISTS set_updated_at ON users;
DROP FUNCTION IF EXISTS set_updated_at_column();
