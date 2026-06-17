-- Rollback: 008_ticket_repo_fields.sql
-- Removes branch_name, pr_url, pr_state columns from tickets
-- WARNING: GitHub integration data will be lost

ALTER TABLE tickets DROP COLUMN IF EXISTS branch_name;
ALTER TABLE tickets DROP COLUMN IF EXISTS pr_url;
ALTER TABLE tickets DROP COLUMN IF EXISTS pr_state;
