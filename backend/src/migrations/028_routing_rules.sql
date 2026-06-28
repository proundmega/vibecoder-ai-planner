ALTER TABLE project_providers ADD COLUMN IF NOT EXISTS routing_rules JSONB DEFAULT NULL;

COMMENT ON COLUMN project_providers.routing_rules IS
  'Rule-based model routing: { "rules": [{ "match": { "labels": [], "priority": "" }, "provider": "", "endpoint_url": "", "model": "" }], "fallback": { ... } }';
