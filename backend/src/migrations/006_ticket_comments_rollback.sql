-- Rollback: 006_ticket_comments.sql
-- Drops ticket_comments table
-- WARNING: All comment data will be lost

DROP TABLE IF EXISTS ticket_comments CASCADE;
