-- Rollback: 010_project_credentials.sql
-- Drops project_credentials table
-- WARNING: All credential data will be lost

DROP TABLE IF EXISTS project_credentials CASCADE;
