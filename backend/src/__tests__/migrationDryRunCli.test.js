const { execFileSync } = require('child_process');
const path = require('path');
const pkg = require('../../package.json');

describe('migration dry-run CLI', () => {
  it('exposes an npm script for dry-run migrations', () => {
    expect(pkg.scripts['db:migrate:dry-run']).toBe('node src/migrations/apply.js --dry-run');
  });

  it('announces dry-run mode and never applies migrations', () => {
    const output = execFileSync(
      process.execPath,
      [path.join(__dirname, '../migrations/apply.js'), '--dry-run'],
      {
        encoding: 'utf8',
        timeout: 60000,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          DATABASE_URL: 'postgresql://invalid:invalid@127.0.0.1:1/none',
          PGCONNECT_TIMEOUT: '1',
        },
      }
    );

    expect(output).toContain('DRY-RUN MODE');
    expect(output).toContain('[DRY-RUN] Would run data migration');
    expect(output).not.toContain('✓ Statement');
  });
});
