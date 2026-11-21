'use strict';

/**
 * Regression for the fg-54 clean cut: once 057 has removed the legacy schema,
 * a second `node src/migrations/apply.js` must not re-execute the legacy
 * migrations (013/036/040/052/055/059 reference columns or tables that 057
 * dropped). The ledger baselines the registered chain on the post-cut schema.
 *
 * The integration bootstrap applies every registered file directly, so the
 * database is at the post-cut state and has no ledger when this test starts.
 */

const { execFile } = require('child_process');
const path = require('path');

jest.setTimeout(120000);

const APPLY = path.join(__dirname, '../../migrations/apply.js');
const CWD = path.join(__dirname, '../..');

function runApply() {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [APPLY],
      {
        cwd: CWD,
        env: { ...process.env },
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`apply.js failed: ${stderr || stdout || error.message}`));
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

describe('fg-54 migration ledger re-run', () => {
  test('apply.js can run twice against the post-cut schema', async () => {
    const first = await runApply();
    expect(first.stdout).toContain('Clean-cut schema detected without a migration ledger');
    expect(first.stdout).toContain('Migrations completed successfully');

    const second = await runApply();
    expect(second.stdout).not.toContain('Clean-cut schema detected without a migration ledger');
    expect(second.stdout).toContain('Migrations completed successfully');

    const ledger = await global.db.query(
      'SELECT filename FROM schema_migrations WHERE filename = $1',
      ['057_agent_fleet_clean_cut.sql']
    );
    expect(ledger.rows).toHaveLength(1);

    const schema = await global.db.query(
      `SELECT
         to_regclass('public.agent_runtimes') IS NOT NULL AS has_runtimes,
         to_regclass('public.agents') IS NOT NULL AS has_agents`
    );
    expect(schema.rows[0]).toEqual({ has_runtimes: true, has_agents: false });
  });
});
