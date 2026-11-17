const {
  redactText,
  redactProfile,
  redactResult,
} = require('../utils/repoProfileRedaction');

describe('repo-profile redaction', () => {
  test('redacts literal client passwords in commands', () => {
    for (const command of [
      'mysql -uroot -psecret',
      'MYSQL -psecret',
      'mysql -u root -p hunter2',
      'mysqladmin -u root -psecret ping',
      'mysqldump -u root -psecret db',
      'redis-cli -a secret',
      'REDIS-CLI -a secret',
      'REDISCLI_AUTH=secret redis-cli ping',
      'PGPASSWORD=hunter2 psql',
      'DB_PASS=secret',
      'PGPASS=secret',
      'DBPASS=secret',
      'PASS=secret',
      'AUTH=secret',
      'AUTHORIZATION=secret',
    ]) {
      const redacted = redactText(command);
      expect(redacted).not.toContain('secret');
      expect(redacted).not.toContain('hunter2');
      expect(redacted).toContain('[REDACTED]');
    }
  });

  test('keeps environment references, ports, prompts and placeholders intact', () => {
    expect(redactText('mysql -P 3306 -u root')).toBe('mysql -P 3306 -u root');
    expect(redactText('MYSQL -P 3306 -u root')).toBe('MYSQL -P 3306 -u root');
    expect(redactText('mysql -p -h db -u root')).toBe('mysql -p -h db -u root');
    expect(redactText('mysql -p "$MYSQL_PWD"')).toBe('mysql -p "$MYSQL_PWD"');
    expect(redactText(
      'docker pull node@sha256:' + 'a'.repeat(64),
    )).toBe('docker pull node@sha256:' + 'a'.repeat(64));
    expect(redactText('PGPASSWORD=$PGPASSWORD psql')).toBe(
      'PGPASSWORD=$PGPASSWORD psql',
    );
    expect(redactText('REDISCLI_AUTH=$REDISCLI_AUTH redis-cli ping')).toBe(
      'REDISCLI_AUTH=$REDISCLI_AUTH redis-cli ping',
    );
    expect(redactText('postgresql://vibecode:${password}@${host}:5432/test')).toBe(
      'postgresql://vibecode:${password}@${host}:5432/test',
    );
  });

  test('redacts URL userinfo, generated-password shapes and tokens', () => {
    const password = 'a'.repeat(64);
    const redacted = redactText(
      `postgresql://vibecode:hunter2@postgres:5432/test ${password} `
        + 'ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    expect(redacted).not.toContain('hunter2');
    expect(redacted).not.toContain(password);
    expect(redacted).not.toContain('ghp_');
    expect(redacted).toContain('[REDACTED]');
  });

  test('redacts credential-bearing profile fields without touching the image digest', () => {
    const image = `postgres@sha256:${'b'.repeat(64)}`;
    const profile = {
      schema_version: 1,
      image,
      setup: ['npm ci'],
      verify: ['mysql -uroot -psecret'],
      env: { NODE_ENV: 'test', PGPASSWORD: 'hunter2' },
      services: [{
        name: 'postgres',
        image,
        env: { POSTGRES_USER: 'vibecode' },
        connection_url: 'postgresql://vibecode:hunter2@${host}:5432/test',
        healthcheck: { command: 'redis-cli -a secret' },
      }],
    };

    const redacted = redactProfile(profile);
    expect(redacted.image).toBe(image);
    expect(redacted.services[0].image).toBe(image);
    expect(JSON.stringify(redacted)).not.toContain('hunter2');
    expect(JSON.stringify(redacted)).not.toContain('secret');
    expect(redacted.verify[0]).toBe('mysql -uroot -p [REDACTED]');
  });

  test('redacts result strings recursively', () => {
    const result = redactResult({
      commands: [{
        phase: 'verify',
        command: 'mysql -uroot -psecret',
        output: `password=${'c'.repeat(64)}`,
      }],
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('c'.repeat(64));
    expect(JSON.stringify(result)).toContain('[REDACTED]');
  });
});
