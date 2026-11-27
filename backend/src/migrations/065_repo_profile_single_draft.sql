-- Migration: 065_repo_profile_single_draft.sql
-- Enforce at most one draft repo profile per project (fg-39 D13).

-- Keep the newest draft per project as the editable one. Older drafts remain
-- in history as inactive rows so their validations and audits are preserved.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY project_id
           ORDER BY version DESC, created_at DESC, id DESC
         ) AS rn
  FROM repo_profiles
  WHERE status = 'draft'
)
UPDATE repo_profiles AS profile
SET status = 'inactive', updated_at = NOW()
FROM ranked
WHERE profile.id = ranked.id AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_repo_profiles_draft
  ON repo_profiles(project_id) WHERE status = 'draft';
