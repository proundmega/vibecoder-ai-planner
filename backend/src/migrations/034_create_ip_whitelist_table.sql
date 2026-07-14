CREATE TABLE IF NOT EXISTS ip_whitelist (
  id SERIAL PRIMARY KEY,
  ip_address VARCHAR(45) NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ip_whitelist_ip_address ON ip_whitelist(ip_address);
