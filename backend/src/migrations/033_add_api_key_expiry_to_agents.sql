ALTER TABLE agents ADD COLUMN IF NOT EXISTS api_key_expires_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS api_key_hash TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS api_key_hash_prefix TEXT;

-- Set default expiry for existing keys (90 days grace period)
UPDATE agents SET api_key_expires_at = NOW() + INTERVAL '90 days'
WHERE api_key_expires_at IS NULL;
