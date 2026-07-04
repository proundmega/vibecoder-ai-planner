-- Add encrypted API key column to provider_configs
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'provider_configs' AND column_name = 'api_key_encrypted') THEN
    ALTER TABLE provider_configs ADD COLUMN api_key_encrypted TEXT;
  END IF;
END $$;
