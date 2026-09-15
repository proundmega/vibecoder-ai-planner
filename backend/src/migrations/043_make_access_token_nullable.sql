-- Migration: 043_make_access_token_nullable.sql
-- Allow NULL access tokens for public repositories

ALTER TABLE project_repos ALTER COLUMN access_token_encrypted DROP NOT NULL;
