-- Rollback: 009_project_providers.sql
-- Drops project_providers table
-- WARNING: All provider configuration data will be lost

DROP TABLE IF EXISTS project_providers CASCADE;
