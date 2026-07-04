-- Migration: 031_expand_credential_types.sql
-- Expand credential_type to include api_key, oauth, bearer types
-- Wrapped in DO $$ block so DROP+ADD are atomic (apply.js runs statements individually)

DO $$
BEGIN
  ALTER TABLE project_credentials DROP CONSTRAINT IF EXISTS valid_credential_type;
  ALTER TABLE project_credentials ADD CONSTRAINT valid_credential_type
    CHECK (credential_type IN ('anthropic', 'openai', 'github', 'custom', 'api_key', 'oauth', 'bearer'));
END $$;
