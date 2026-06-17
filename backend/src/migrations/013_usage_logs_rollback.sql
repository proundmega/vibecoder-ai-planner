-- Rollback: 013_usage_logs.sql
-- Drops usage_logs table
-- WARNING: All usage tracking data will be lost

DROP TABLE IF EXISTS usage_logs CASCADE;
