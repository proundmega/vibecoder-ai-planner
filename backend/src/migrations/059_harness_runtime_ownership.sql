-- Migration: 059_harness_runtime_ownership.sql
-- fg-54 additive bridge: runtime-owned harness runs and leases.
--
-- 056 added the runtime_id columns. This migration relaxes the legacy
-- agents(id) NOT NULL constraints so a node runtime can own a run/lease
-- without inventing an agents row. It is additive; the destructive cut that
-- removes agent_id lives in 057.

ALTER TABLE harness_runs ALTER COLUMN agent_id DROP NOT NULL;
ALTER TABLE harness_leases ALTER COLUMN agent_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_harness_leases_runtime
  ON harness_leases(runtime_id) WHERE runtime_id IS NOT NULL;
