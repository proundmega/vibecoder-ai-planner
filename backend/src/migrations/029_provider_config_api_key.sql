-- Add encrypted API key column to provider_configs
ALTER TABLE provider_configs ADD COLUMN api_key_encrypted TEXT;
