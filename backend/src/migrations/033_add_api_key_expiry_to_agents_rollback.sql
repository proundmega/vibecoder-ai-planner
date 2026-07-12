ALTER TABLE agents DROP COLUMN IF EXISTS api_key_expires_at;
ALTER TABLE agents DROP COLUMN IF EXISTS api_key_hash;
ALTER TABLE agents DROP COLUMN IF EXISTS api_key_hash_prefix;
