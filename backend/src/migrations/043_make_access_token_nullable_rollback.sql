-- Rollback: 043_make_access_token_nullable.sql
-- Restore NOT NULL constraint (will fail if any rows have NULL)

ALTER TABLE project_repos ALTER COLUMN access_token_encrypted SET NOT NULL;
