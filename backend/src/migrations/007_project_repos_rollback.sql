-- Rollback: 007_project_repos.sql
-- Drops project_repos table
-- WARNING: All repository data will be lost

DROP TABLE IF EXISTS project_repos CASCADE;
