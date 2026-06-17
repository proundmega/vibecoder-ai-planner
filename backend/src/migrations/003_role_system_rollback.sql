-- Rollback: 003_role_system.sql
-- Reverts role system changes
-- WARNING: Role and permission data may be lost

ALTER TABLE users DROP COLUMN IF EXISTS role;
ALTER TABLE users DROP COLUMN IF EXISTS is_active;
ALTER TABLE users DROP COLUMN IF EXISTS current_plan;
DROP TABLE IF EXISTS approvals CASCADE;
DROP TABLE IF EXISTS permissions CASCADE;
DROP TABLE IF EXISTS role_permissions CASCADE;
DROP TABLE IF EXISTS roles CASCADE;
