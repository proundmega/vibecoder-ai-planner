-- Migration 016: Ticket Planning Files with Custom Templates

-- Planning files: versioned markdown per ticket
CREATE TABLE IF NOT EXISTS ticket_planning (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  file_key VARCHAR(100) NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT uq_ticket_planning UNIQUE (ticket_id, file_key, version)
);

CREATE INDEX IF NOT EXISTS idx_ticket_planning_ticket_id ON ticket_planning(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_planning_file_key ON ticket_planning(ticket_id, file_key);

-- Attachments: binary files per ticket
CREATE TABLE IF NOT EXISTS ticket_attachments (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  content_type VARCHAR(100) NOT NULL,
  size_bytes INTEGER NOT NULL,
  stored_path TEXT NOT NULL,
  uploaded_by BIGINT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_attachments_ticket_id ON ticket_attachments(ticket_id);

-- Custom template definitions (project-scoped)
CREATE TABLE IF NOT EXISTS project_templates (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  file_definitions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_templates_project_id ON project_templates(project_id);

-- Add columns to tickets table
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tickets' AND column_name = 'planning_status') THEN
    ALTER TABLE tickets ADD COLUMN planning_status VARCHAR(50) DEFAULT 'not_started'
      CHECK (planning_status IN ('not_started', 'template_selected', 'in_progress', 'review', 'completed'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tickets' AND column_name = 'template_schema') THEN
    ALTER TABLE tickets ADD COLUMN template_schema VARCHAR(100);
  END IF;
END $$;
