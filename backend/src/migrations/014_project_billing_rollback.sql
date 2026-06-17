-- Rollback: 014_project_billing.sql
-- Drops project_billing table
-- WARNING: All billing data will be lost

DROP TABLE IF EXISTS project_billing CASCADE;
