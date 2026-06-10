-- Migration: 008_ticket_repo_fields.sql
-- Add GitHub repo fields to tickets table

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS branch_name VARCHAR(255);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS pr_url TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS pr_state VARCHAR(20) DEFAULT 'open';

CREATE INDEX IF NOT EXISTS idx_tickets_branch_name ON tickets(branch_name);
