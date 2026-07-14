-- Add encrypted API key column to provider_configs
ALTER TABLE provider_configs ADD COLUMN IF NOT EXISTS api_key_encrypted TEXT;
