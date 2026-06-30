CREATE TABLE provider_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    provider VARCHAR(32) NOT NULL DEFAULT 'openai',
    endpoint_url VARCHAR(512),
    model VARCHAR(128) NOT NULL,
    api_key_credential_id UUID REFERENCES credentials(id),
    fallback_provider VARCHAR(32),
    routing_rules JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(project_id, provider)
);

CREATE INDEX idx_provider_configs_project ON provider_configs(project_id);
