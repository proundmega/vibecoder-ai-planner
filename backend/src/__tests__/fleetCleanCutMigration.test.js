'use strict';

const path = require('path');

const APPLY = require.resolve('../migrations/apply');
const CLEAN_CUT = '057_agent_fleet_clean_cut.sql';
const BACKFILL = 'backfill_agent_key_hashes.js';

function loadRegistry(flag) {
  jest.resetModules();
  delete process.env.AGENT_FLEET_CLEAN_CUT;
  if (flag != null) {
    process.env.AGENT_FLEET_CLEAN_CUT = flag;
  }
  return require(APPLY);
}

describe('fg-54 fleet clean-cut migration gate', () => {
  afterEach(() => {
    delete process.env.AGENT_FLEET_CLEAN_CUT;
    jest.resetModules();
  });

  test('the destructive 057 stays out of the default migration chain', () => {
    const registry = loadRegistry();
    const names = registry.SQL_FILES.map((file) => path.basename(file));

    expect(names).not.toContain(CLEAN_CUT);
    expect(registry.DATA_MIGRATIONS.map((file) => path.basename(file)))
      .toContain(BACKFILL);
  });

  test('the joint clean-cut switch appends 057 after 059 and skips the legacy backfill', () => {
    const registry = loadRegistry('1');
    const names = registry.SQL_FILES.map((file) => path.basename(file));

    expect(names).toContain(CLEAN_CUT);
    expect(names.indexOf(CLEAN_CUT)).toBeGreaterThan(
      names.indexOf('059_harness_runtime_ownership.sql'));
    expect(registry.DATA_MIGRATIONS.map((file) => path.basename(file)))
      .not.toContain(BACKFILL);
  });

  test('a value other than 1 leaves the clean cut disabled', () => {
    const names = loadRegistry('true').SQL_FILES.map((file) => path.basename(file));
    expect(names).not.toContain(CLEAN_CUT);
  });
});
