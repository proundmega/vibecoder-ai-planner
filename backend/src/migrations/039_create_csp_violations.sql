CREATE TABLE IF NOT EXISTS csp_violations (
  id SERIAL PRIMARY KEY,
  violated_directive VARCHAR(255),
  blocked_uri VARCHAR(1024),
  document_uri VARCHAR(1024),
  referrer VARCHAR(1024),
  original_policy TEXT,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_csp_violations_created_at ON csp_violations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_csp_violations_directive ON csp_violations(violated_directive);
