-- Rollback: 031_expand_credential_types.sql
-- Restore original credential_type constraint

ALTER TABLE project_credentials
  DROP CONSTRAINT IF EXISTS valid_credential_type;

ALTER TABLE project_credentials
  ADD CONSTRAINT valid_credential_type
  CHECK (credential_type IN ('anthropic', 'openai', 'github', 'custom'));
