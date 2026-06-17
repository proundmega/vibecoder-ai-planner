-- Rollback: 005_permission_system.sql
-- Reverts permission system changes
-- WARNING: All permission and role data will be lost

DROP TABLE IF EXISTS permissions CASCADE;
DROP TABLE IF EXISTS role_permissions CASCADE;
DROP TABLE IF EXISTS roles CASCADE;
