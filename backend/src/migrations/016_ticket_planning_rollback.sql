-- Rollback: 016_ticket_planning.sql
-- Drops planning-related tables and columns
-- WARNING: All planning files and attachments will be lost

DROP TABLE IF EXISTS ticket_planning CASCADE;
DROP TABLE IF EXISTS ticket_attachments CASCADE;
DROP TABLE IF EXISTS project_templates CASCADE;
ALTER TABLE tickets DROP COLUMN IF EXISTS planning_status;
ALTER TABLE tickets DROP COLUMN IF EXISTS template_schema;
