const { spawnSync } = require('child_process');
const path = require('path');
const pkg = require('../../package.json');

describe('migration dry-run CLI', () => {
  it('exposes an npm script for dry-run migrations', () => {
    expect(pkg.scripts['db:migrate:dry-run']).toBe('node src/migrations/apply.js --dry-run');
  });

  it('announces dry-run mode, classifies statements and never connects to the DB', () => {
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, '../migrations/apply.js'), '--dry-run'],
      {
        encoding: 'utf8',
        timeout: 60000,
        env: {
          ...process.env,
          DATABASE_URL: 'postgresql://invalid:invalid@127.0.0.1:1/none',
          PGCONNECT_TIMEOUT: '1',
        },
      }
    );
    const output = `${result.stdout || ''}${result.stderr || ''}`;

    expect(result.status).toBe(0);
    expect(output).toContain('DRY-RUN MODE');
    expect(output).toContain('[DRY-RUN] Would run data migration');
    expect(output).toContain('Summary:');
    expect(output).not.toContain('✓ Statement');
    expect(output).not.toContain('Error in');
    expect(output).not.toContain('ECONNREFUSED');
  });
});
