'use strict';

const fs = require('fs');
const path = require('path');

const APPLY = require.resolve('../migrations/apply');
const CLEAN_CUT = '057_agent_fleet_clean_cut.sql';
const BACKFILL = 'backfill_agent_key_hashes.js';

function loadRegistry() {
  jest.resetModules();
  return require(APPLY);
}

describe('fg-54 fleet clean-cut migration registration', () => {
  afterEach(() => {
    jest.resetModules();
  });

  test('057 runs by default after 059 and the legacy backfill is gone', () => {
    const registry = loadRegistry();
    const names = registry.SQL_FILES.map((file) => path.basename(file));

    expect(names).toContain(CLEAN_CUT);
    expect(names.indexOf(CLEAN_CUT)).toBeGreaterThan(
      names.indexOf('059_harness_runtime_ownership.sql'));
    expect(registry.DATA_MIGRATIONS.map((file) => path.basename(file)))
      .not.toContain(BACKFILL);
  });

  test('ships the joint runner used by the Fleet Clean Cut CI stage', () => {
    const script = fs.readFileSync(
      path.join(__dirname, '../../integration-test/fleet-clean-cut.sh'),
      'utf8'
    );

    expect(script).not.toContain('AGENT_FLEET_CLEAN_CUT');
    expect(script).toContain('REQUIRE_FLEET_SCHEMA=1');
    expect(script).toContain('managerFleet.integration.test.js');
  });
});
