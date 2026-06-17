-- Rollback: 001_base_schema.sql
-- Drops all tables created in the base schema migration
-- WARNING: All data in these tables will be lost

DROP TABLE IF EXISTS ticket_comments CASCADE;
DROP TABLE IF EXISTS ticket_messages CASCADE;
DROP TABLE IF EXISTS ticket_messages_attachments CASCADE;
DROP TABLE IF EXISTS agent_memory CASCADE;
DROP TABLE IF EXISTS usage_logs CASCADE;
DROP TABLE IF EXISTS project_billing CASCADE;
DROP TABLE IF EXISTS project_credentials CASCADE;
DROP TABLE IF EXISTS project_providers CASCADE;
DROP TABLE IF EXISTS project_repos CASCADE;
DROP TABLE IF EXISTS ticket_planning CASCADE;
DROP TABLE IF EXISTS ticket_attachments CASCADE;
DROP TABLE IF EXISTS project_templates CASCADE;
DROP TABLE IF EXISTS approvals CASCADE;
DROP TABLE IF EXISTS permissions CASCADE;
DROP TABLE IF EXISTS role_permissions CASCADE;
DROP TABLE IF EXISTS roles CASCADE;
DROP TABLE IF EXISTS agents CASCADE;
DROP TABLE IF EXISTS tickets CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS _migrations CASCADE;
