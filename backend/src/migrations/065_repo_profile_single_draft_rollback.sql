-- Rollback: 065_repo_profile_single_draft.sql
-- Removes the single-draft constraint. Retired older drafts are not restored
-- to draft status; they stay inactive in history.

DROP INDEX IF EXISTS uq_repo_profiles_draft;
