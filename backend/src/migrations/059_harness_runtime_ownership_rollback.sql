-- Rollback: 059_harness_runtime_ownership.sql
-- Restoring NOT NULL is only safe once no runtime-only rows remain. Fail
-- loudly instead of deleting harness evidence or inventing agent ids.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM harness_runs WHERE agent_id IS NULL)
     OR EXISTS (SELECT 1 FROM harness_leases WHERE agent_id IS NULL) THEN
    RAISE EXCEPTION
      'cannot restore NOT NULL: runtime-owned harness runs or leases still exist';
  END IF;
END $$;

ALTER TABLE harness_runs ALTER COLUMN agent_id SET NOT NULL;
ALTER TABLE harness_leases ALTER COLUMN agent_id SET NOT NULL;

DROP INDEX IF EXISTS idx_harness_leases_runtime;
