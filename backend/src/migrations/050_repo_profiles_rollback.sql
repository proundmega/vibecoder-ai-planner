-- Rollback for 050_repo_profiles.sql (fg-39)

ALTER TABLE harness_runs DROP COLUMN IF EXISTS repo_profile_version;
ALTER TABLE harness_runs DROP COLUMN IF EXISTS repo_profile_id;

DROP TABLE IF EXISTS repo_profile_validations;
DROP TABLE IF EXISTS repo_profiles;
