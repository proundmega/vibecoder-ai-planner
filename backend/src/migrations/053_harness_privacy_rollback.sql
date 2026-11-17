-- Rollback: 053_harness_privacy.sql
ALTER TABLE harness_runs DROP COLUMN IF EXISTS provider_base_url;
ALTER TABLE harness_runs DROP COLUMN IF EXISTS provider_region;
DROP TABLE IF EXISTS harness_privacy_policies;
