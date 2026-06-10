-- Migration: 014_project_billing.sql
-- Monthly billing aggregation for projects

CREATE TABLE IF NOT EXISTS project_billing (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  billing_month DATE NOT NULL,
  total_cost_usd DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_tokens_in BIGINT NOT NULL DEFAULT 0,
  total_tokens_out BIGINT NOT NULL DEFAULT 0,
  total_calls INTEGER NOT NULL DEFAULT 0,
  is_finalized BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_project_month UNIQUE (project_id, billing_month)
);

CREATE INDEX idx_project_billing_month ON project_billing(billing_month);
CREATE INDEX idx_project_billing_project_id ON project_billing(project_id);
