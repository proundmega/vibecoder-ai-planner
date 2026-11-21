'use strict';

const {
  isCleanCutBaselineRow,
  planMigrationRun,
} = require('../migrations/apply');

describe('fg-54 migration ledger planning', () => {
  const files = [
    '/migrations/001_create_tables.sql',
    '/migrations/013_usage_logs.sql',
    '/migrations/057_agent_fleet_clean_cut.sql',
  ];

  test('a fresh database runs every registered file in order', () => {
    const plan = planMigrationRun({ files, applied: [] });

    expect(plan).toEqual({
      baseline: false,
      toRun: files,
      skipped: [],
    });
  });

  test('already recorded files are skipped', () => {
    const plan = planMigrationRun({
      files,
      applied: new Set(['001_create_tables.sql']),
    });

    expect(plan.toRun).toEqual(files.slice(1));
    expect(plan.skipped).toEqual(['001_create_tables.sql']);
    expect(plan.baseline).toBe(false);
  });

  test('a post-cut baseline skips every registered file', () => {
    const plan = planMigrationRun({ files, applied: [], baseline: true });

    expect(plan.toRun).toEqual([]);
    expect(plan.skipped).toEqual(files.map((file) => file.split('/').pop()));
    expect(plan.baseline).toBe(true);
  });

  test('detects the cut only when runtimes exist and legacy agents are gone', () => {
    expect(isCleanCutBaselineRow({ has_runtimes: true, has_agents: false })).toBe(true);
    expect(isCleanCutBaselineRow({ has_runtimes: true, has_agents: true })).toBe(false);
    expect(isCleanCutBaselineRow({ has_runtimes: false, has_agents: true })).toBe(false);
    expect(isCleanCutBaselineRow({ has_runtimes: false, has_agents: false })).toBe(false);
    expect(isCleanCutBaselineRow(null)).toBe(false);
  });
});
