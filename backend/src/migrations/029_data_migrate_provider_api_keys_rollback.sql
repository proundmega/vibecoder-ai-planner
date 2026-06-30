-- Rollback for data migration: clear api_key_encrypted populated from credentials
-- This does NOT restore api_key_credential_id - that column remains unchanged.
-- The data migration only copies decrypted keys; it doesn't modify credential references.

ALTER TABLE provider_configs DROP COLUMN IF EXISTS api_key_encrypted;
