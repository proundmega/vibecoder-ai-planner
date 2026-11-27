const fs = require('fs');
const path = require('path');

jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

jest.mock('../models/project', () => ({
  findById: jest.fn(),
}));

jest.mock('../services/GitHubService', () => ({
  getProjectRepo: jest.fn(),
  readRepoFile: jest.fn(),
}));

const RepoProfileService = require('../services/RepoProfileService');
const { validateRepoProfile } = require('../validators/repoProfiles');
const Project = require('../models/project');
const GitHubService = require('../services/GitHubService');
const { pool } = require('../db');
const { ForbiddenError } = require('../errors/HttpError');

const REPO = {
  repoUrl: 'https://github.com/acme/app.git',
  defaultBranch: 'main',
};

function owner() {
  return { userId: 7, id: 7, role: 'project_admin' };
}

function superAdmin() {
  return { userId: 99, id: 99, role: 'super_admin' };
}

function clientWith(responses) {
  const client = { query: jest.fn(), release: jest.fn() };
  for (const response of responses) {
    client.query.mockResolvedValueOnce(response);
  }
  pool.connect.mockResolvedValueOnce(client);
  return client;
}

function validService(overrides = {}) {
  return {
    name: 'postgres',
    image: `postgres@sha256:${'a'.repeat(64)}`,
    env: { POSTGRES_USER: 'vibecode', POSTGRES_DB: 'test' },
    password_env: 'POSTGRES_PASSWORD',
    connection_env: 'DATABASE_URL',
    connection_url: 'postgresql://vibecode:${password}@${host}:5432/test',
    healthcheck: {
      command: 'pg_isready -U vibecode -d test',
      interval_seconds: 2,
      timeout_seconds: 5,
      retries: 30,
    },
    ...overrides,
  };
}

function validProfile(overrides = {}) {
  return {
    schema_version: 1,
    repo_url: 'https://github.com/acme/app',
    base_branch: 'main',
    languages: ['node'],
    setup: ['npm ci'],
    verify: ['npm test'],
    env: { NODE_ENV: 'test' },
    timeouts: { setup_minutes: 15, verify_minutes: 20 },
    max_round_minutes: 45,
    services: [],
    flaky_tests: [],
    ...overrides,
  };
}

describe('RepoProfileService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.REPO_PROFILE_STACK_IMAGES;
    Project.findById.mockResolvedValue({ id: 1, ownerId: 7 });
    GitHubService.getProjectRepo.mockResolvedValue(REPO);
    GitHubService.readRepoFile.mockResolvedValue(null);
    pool.query.mockResolvedValue({ rows: [] });
  });

  describe('access control', () => {
    it('allows the project owner and members to read', async () => {
      Project.findById.mockResolvedValue({ id: 1, ownerId: 7 });
      await expect(RepoProfileService.assertCanRead(1, owner())).resolves.toBeTruthy();

      Project.findById.mockResolvedValue({ id: 1, ownerId: 7 });
      pool.query.mockResolvedValueOnce({ rows: [{ user_id: 8 }] });
      await expect(RepoProfileService.assertCanRead(1, { userId: 8, role: 'member' }))
        .resolves.toBeTruthy();
    });

    it('rejects a non-member read', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      await expect(RepoProfileService.assertCanRead(1, { userId: 8, role: 'member' }))
        .rejects.toThrow(ForbiddenError);
    });

    it('allows only the owner or super admin to write', async () => {
      await expect(RepoProfileService.assertCanWrite(1, owner())).resolves.toBeTruthy();
      await expect(RepoProfileService.assertCanWrite(1, superAdmin())).resolves.toBeTruthy();
      await expect(RepoProfileService.assertCanWrite(1, { userId: 8, role: 'member' }))
        .rejects.toThrow(ForbiddenError);
    });

    it('requires the agent owner for agent reads', async () => {
      await expect(RepoProfileService.assertAgentProjectAccess(1, { id: 3, owner_id: 7 }))
        .resolves.toBeTruthy();
      await expect(RepoProfileService.assertAgentProjectAccess(1, { id: 3, owner_id: 8 }))
        .rejects.toThrow(ForbiddenError);
    });
  });

  describe('create', () => {
    it('creates the next draft version and stores the validated profile', async () => {
      const stored = {
        id: 'p1',
        project_id: 1,
        version: 2,
        profile: validProfile(),
        status: 'draft',
      };
      const client = clientWith([
        {}, // BEGIN
        { rows: [{ id: 1 }] }, // project lock
        {}, // retire the current draft
        { rows: [{ version: 2 }] }, // max version
        { rows: [stored] }, // INSERT
        {}, // COMMIT
      ]);

      const result = await RepoProfileService.create(1, validProfile(), owner());

      expect(result).toEqual(expect.objectContaining({ id: 'p1', version: 2, status: 'draft' }));
      expect(client.query.mock.calls[2][0]).toContain("status = 'inactive'");
      expect(client.query.mock.calls[4][0]).toContain('INSERT INTO repo_profiles');
      expect(client.query.mock.calls[4][1][1]).toBe(2);
      expect(JSON.parse(client.query.mock.calls[4][1][2])).toEqual(
        expect.objectContaining({ verify: ['npm test'] })
      );
      expect(client.release).toHaveBeenCalled();
    });


    it('records create and retirement events', async () => {
      const stored = {
        id: 'p2', project_id: 1, version: 2,
        profile: validProfile(), status: 'draft',
      };
      clientWith([
        {}, // BEGIN
        { rows: [{ id: 1 }] }, // project lock
        { rows: [{ id: 'p1', version: 1 }] }, // retired draft
        { rows: [{ version: 2 }] }, // max version
        { rows: [stored] }, // INSERT
        {}, // COMMIT
      ]);

      await RepoProfileService.create(1, validProfile(), owner());

      const events = pool.query.mock.calls.filter(
        ([sql]) => String(sql).includes('INSERT INTO repo_profile_events')
      );
      expect(events.map((call) => call[1][4])).toEqual(['created', 'retired']);
      expect(events[1][1][1]).toBe('p1');
      expect(JSON.parse(events[1][1][7])).toEqual({ superseded_by_version: 2 });
    });

    it('requires an active connected repository for create and update', async () => {
      GitHubService.getProjectRepo.mockResolvedValue(null);

      await expect(
        RepoProfileService.create(1, validProfile(), owner())
      ).rejects.toThrow(/Connect an active repository/);
      await expect(
        RepoProfileService.update(1, 'p1', validProfile(), owner())
      ).rejects.toThrow(/Connect an active repository/);
      expect(pool.connect).not.toHaveBeenCalled();
    });

    it('accepts an egress mTLS reference scoped to its credential', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          is_active: true,
          key_encrypted: 'enc:key',
          metadata: {
            kind: 'mtls-client',
            cert_b64: 'cert',
            hosts: ['registry.example.com'],
          },
        }],
      });
      const stored = {
        id: 'p1', project_id: 1, version: 1, status: 'draft', profile: validProfile(),
      };
      clientWith([
        {},
        { rows: [{ id: 1 }] },
        {}, // retire the current draft
        { rows: [{ version: 1 }] },
        { rows: [stored] },
        {},
      ]);
      const profile = validProfile({
        egress: {
          tls_mode: 'terminate',
          mtls: { credential_id: 5, hosts: ['registry.example.com'] },
        },
      });

      await expect(RepoProfileService.create(1, profile, owner())).resolves.toBeTruthy();
      expect(pool.query.mock.calls[0][0]).toContain('FROM project_credentials');
    });

    it('rejects an egress mTLS reference outside the credential scope', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          is_active: true,
          key_encrypted: 'enc:key',
          metadata: {
            kind: 'mtls-client',
            cert_b64: 'cert',
            hosts: ['registry.example.com'],
          },
        }],
      });

      await expect(RepoProfileService.create(1, validProfile({
        egress: {
          tls_mode: 'terminate',
          mtls: { credential_id: 5, hosts: ['other.example.com'] },
        },
      }), owner())).rejects.toThrow(/not scoped/);
      expect(pool.connect).not.toHaveBeenCalled();
    });

    it('rejects a repo_url that does not match the connected repository', async () => {
      await expect(
        RepoProfileService.create(
          1,
          validProfile({ repo_url: 'https://github.com/other/repo' }),
          owner()
        )
      ).rejects.toThrow(/must match the repository connected/);
      expect(pool.connect).not.toHaveBeenCalled();
    });

    it('rejects a missing verify list before opening a transaction', async () => {
      await expect(
        RepoProfileService.create(1, validProfile({ verify: [] }), owner())
      ).rejects.toThrow(/verify/);
      expect(pool.connect).not.toHaveBeenCalled();
    });

    it('rejects an image without a digest', async () => {
      await expect(
        RepoProfileService.create(1, validProfile({ image: 'node:24-alpine' }), owner())
      ).rejects.toThrow(/sha256/);
    });

    it('accepts registry ports, tags and one digest in profile and service images', () => {
      const image = `registry.example:5000/team/image:tag@sha256:${'a'.repeat(64)}`;
      const result = validateRepoProfile(validProfile({
        image,
        services: [validService({ image })],
      }));
      expect(result.error).toBeUndefined();
      expect(result.value.image).toBe(image);
      expect(result.value.services[0].image).toBe(image);
    });

    it('rejects userinfo and multiple digest separators in profile and service images', async () => {
      const digest = 'a'.repeat(64);
      for (const image of [
        `user:pass@registry.example/node@sha256:${digest}`,
        `registry.example/node@sha256:${digest}@sha256:${digest}`,
      ]) {
        await expect(
          RepoProfileService.create(1, validProfile({ image }), owner())
        ).rejects.toThrow(/sha256/);
        await expect(
          RepoProfileService.create(
            1,
            validProfile({ services: [validService({ image })] }),
            owner()
          )
        ).rejects.toThrow(/sha256/);
      }
    });

    it('rejects unsafe base branch names', async () => {
      for (const branch of ['-main', 'feature//x', 'feature/', 'main..x', 'main.']) {
        await expect(
          RepoProfileService.create(1, validProfile({ base_branch: branch }), owner())
        ).rejects.toThrow(/base_branch/);
      }
    });

    it('rejects secret-like env keys and values', async () => {
      await expect(
        RepoProfileService.create(1, validProfile({ env: { GITHUB_TOKEN: 'x' } }), owner())
      ).rejects.toThrow(/looks secret/);
      await expect(
        RepoProfileService.create(1, validProfile({ env: { MY_KEY: 'x' } }), owner())
      ).rejects.toThrow(/looks secret/);

      await expect(
        RepoProfileService.create(
          1,
          validProfile({ env: { NODE_ENV: 'https://user:pass@example.test' } }),
          owner()
        )
      ).rejects.toThrow(/looks like a credential/);
    });

    it('rejects unknown fields but accepts supported caches', async () => {
      await expect(
        RepoProfileService.create(1, validProfile({ wat: true }), owner())
      ).rejects.toThrow(/unknown profile field/);

      const stored = {
        id: 'p1', project_id: 1, version: 1,
        profile: validProfile({ caches: ['npm', 'maven'] }), status: 'draft',
      };
      clientWith([
        {},
        { rows: [{ id: 1 }] },
        {}, // retire the current draft
        { rows: [{ version: 1 }] },
        { rows: [stored] },
        {},
      ]);
      await expect(RepoProfileService.create(
        1, validProfile({ caches: ['npm', 'maven'] }), owner()
      )).resolves.toBeTruthy();
    });

    it('accepts a valid service container definition', async () => {
      const stored = {
        id: 'p1', project_id: 1, version: 1,
        profile: validProfile({ services: [validService()] }), status: 'draft',
      };
      clientWith([
        {},
        { rows: [{ id: 1 }] },
        {}, // retire the current draft
        { rows: [{ version: 1 }] },
        { rows: [stored] },
        {},
      ]);

      await expect(RepoProfileService.create(
        1, validProfile({ services: [validService()] }), owner()
      )).resolves.toBeTruthy();
    });

    it('rejects password-suffixed keys and literal credentials in URLs and commands', async () => {
      for (const key of ['DB_PASS', 'DB_PWD', 'PGPASS', 'DBPASS']) {
        await expect(RepoProfileService.create(1, validProfile({
          env: { [key]: 'x' },
        }), owner())).rejects.toThrow(/looks secret/);
        await expect(RepoProfileService.create(1, validProfile({
          services: [validService({ env: { POSTGRES_USER: 'vibecode', [key]: 'x' } })],
        }), owner())).rejects.toThrow(/looks secret/);
      }

      const hex = 'a'.repeat(64);
      for (const connectionUrl of [
        'postgresql://vibecode:hunter2@${host}:5432/test?token=${password}',
        'postgresql://vibecode:${password}@${host}:5432/test?password=hunter2',
        'postgresql://vibecode:${password}@${host}:5432/password=hunter2',
        `postgresql://vibecode:\${password}@\${host}:5432/${hex}`,
        `postgresql://vibecode:\${password}@\${host}:5432/test?auth=${hex}`,
        `postgresql://vibecode:\${password}@\${host}:5432/test?x=${hex}`,
        `postgresql://vibecode:\${password}@\${host}:5432/test#x=${hex}`,
        'postgresql://vibecode:%24%7Bpassword%7D@${host}:5432/test',
        'postgresql://vibecode:${password}@${host}:5432/test\nEVIL=1',
      ]) {
        await expect(RepoProfileService.create(1, validProfile({
          services: [validService({ connection_url: connectionUrl })],
        }), owner())).rejects.toThrow(/connection_url/);
      }

      for (const command of [
        'PGPASSWORD=hunter2 pg_isready',
        'mysql -uroot -psecret',
        'mysql -u root -p hunter2',
        'redis-cli -a secret',
        'REDIS-CLI -a secret',
        'REDISCLI_AUTH=secret redis-cli ping',
      ]) {
        await expect(RepoProfileService.create(1, validProfile({
          services: [validService({ healthcheck: { command } })],
        }), owner())).rejects.toThrow(/healthcheck.command/);
      }

      await expect(RepoProfileService.create(1, validProfile({
        env: { LD_PRELOAD: '/evil.so' },
      }), owner())).rejects.toThrow(/reserved/);

      await expect(RepoProfileService.create(1, validProfile({
        verify: ['PGPASSWORD=hunter2 psql -c "select 1"'],
      }), owner())).rejects.toThrow(/literal credential/);

      await expect(RepoProfileService.create(1, validProfile({
        services: [validService({ env: { POSTGRES_USER: 'vibecode', PATH: '/evil' } })],
      }), owner())).rejects.toThrow(/reserved/);

      await expect(RepoProfileService.create(1, validProfile({
        services: [validService({ connection_env: 'DATABASE_PASSWORD' })],
      }), owner())).rejects.toThrow(/must not look secret/);
    });


    it('distinguishes mysql port/prompt flags from client passwords', () => {
      for (const command of [
        'mysql -P 3306 -h db -u root',
        'MYSQL -P 3306 -h db -u root',
        'mysql -p -h db -u root',
        'mysql -p "$MYSQL_PWD" -h db -u root',
      ]) {
        const result = validateRepoProfile(validProfile({
          services: [validService({ healthcheck: { command } })],
        }));
        expect(result.error).toBeUndefined();
      }
      for (const command of [
        'mysql -uroot -psecret',
        'MYSQL -psecret',
        'mysql -u root -p hunter2',
        'mysqladmin -u root -psecret ping',
        'mysqldump -u root -psecret db',
        'redis-cli -a secret',
        'REDIS-CLI -a secret',
        'REDISCLI_AUTH=secret redis-cli ping',
      ]) {
        const result = validateRepoProfile(validProfile({
          services: [validService({ healthcheck: { command } })],
        }));
        expect(result.error).toBeDefined();
      }
      for (const env of [
        { REDISCLI_AUTH: 'secret' },
        { AUTHORIZATION: 'secret' },
        { AUTH: 'secret' },
        { BASIC_AUTH: 'secret' },
        { DB_PASS: 'secret' },
        { PGPASS: 'secret' },
        { PASS: 'secret' },
      ]) {
        const result = validateRepoProfile(validProfile({
          services: [validService({
            env: { POSTGRES_USER: 'vibecode', ...env },
          })],
        }));
        expect(result.error).toBeDefined();
      }
      const authMode = validateRepoProfile(validProfile({
        services: [validService({
          env: { POSTGRES_USER: 'vibecode', AUTH_MODE: 'token' },
        })],
      }));
      expect(authMode.error).toBeUndefined();
    });

    it('accepts environment references in commands', async () => {
      const stored = {
        id: 'p1', project_id: 1, version: 1,
        profile: validProfile({
          verify: ['PGPASSWORD=$PGPASSWORD psql -c "select 1"'],
        }),
        status: 'draft',
      };
      clientWith([
        {},
        { rows: [{ id: 1 }] },
        {}, // retire the current draft
        { rows: [{ version: 1 }] },
        { rows: [stored] },
        {},
      ]);
      await expect(RepoProfileService.create(1, validProfile({
        verify: ['PGPASSWORD=$PGPASSWORD psql -c "select 1"'],
      }), owner())).resolves.toBeTruthy();
    });

    it('rejects unsafe or inconsistent service definitions', async () => {
      const cases = [
        validService({ image: 'postgres:16' }),
        validService({ healthcheck: undefined }),
        validService({ connection_url: 'postgresql://vibecode:secret@db:5432/test' }),
        validService({ connection_url: 'postgresql://${host}:5432/test' }),
        validService({ password_env: 'POSTGRES_PASSWORD', env: {
          POSTGRES_USER: 'vibecode', POSTGRES_PASSWORD: 'x',
        } }),
      ];
      for (const service of cases) {
        await expect(RepoProfileService.create(
          1, validProfile({ services: [service] }), owner()
        )).rejects.toThrow();
      }
      await expect(RepoProfileService.create(1, validProfile({
        env: { DATABASE_URL: 'not-secret' },
        services: [validService()],
      }), owner())).rejects.toThrow(/connection_env/);
      await expect(RepoProfileService.create(1, validProfile({
        services: [validService(), validService()],
      }), owner())).rejects.toThrow(/unique/);
    });
  });

  describe('update and activate', () => {

    it('hashes profile content canonically so edits invalidate prior validations', () => {
      const first = RepoProfileService.profileHash({ b: 2, a: 1 });
      const reordered = RepoProfileService.profileHash({ a: 1, b: 2 });
      const edited = RepoProfileService.profileHash({ a: 1, b: 3 });

      expect(first).toBe(reordered);
      expect(first).not.toBe(edited);
      expect(first).toMatch(/^[a-f0-9]{64}$/);
    });

    it('records an update event with the changed fields', async () => {
      const current = {
        id: 'p1', project_id: 1, version: 1,
        status: 'draft', profile: validProfile(),
      };
      pool.query
        .mockResolvedValueOnce({ rows: [current] })
        .mockResolvedValueOnce({
          rows: [{
            ...current,
            profile: validProfile({ verify: ['npm run lint'] }),
          }],
        });

      await RepoProfileService.update(
        1, 'p1', validProfile({ verify: ['npm run lint'] }), owner()
      );

      const event = pool.query.mock.calls.find(
        ([sql]) => String(sql).includes('INSERT INTO repo_profile_events')
      );
      expect(event[1][4]).toBe('updated');
      expect(JSON.parse(event[1][7]).changed_fields).toContain('verify');
    });

    it('updates only a draft profile', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 'p1', status: 'active', profile: {} }] });

      await expect(
        RepoProfileService.update(1, 'p1', validProfile(), owner())
      ).rejects.toThrow(/Only draft profiles/);
    });


    it('refuses to activate a profile after the project repo changes or disconnects', async () => {
      const target = {
        id: 'p2', project_id: 1, version: 2, profile: validProfile(), status: 'draft',
      };
      const client = clientWith([
        {}, // BEGIN
        { rows: [target] }, // target lock
        {}, // ROLLBACK
      ]);
      GitHubService.getProjectRepo.mockResolvedValue({
        repoUrl: 'https://github.com/acme/other.git',
        defaultBranch: 'main',
      });

      await expect(RepoProfileService.activate(1, 'p2', owner()))
        .rejects.toThrow(/must match the repository connected/);
      expect(client.query.mock.calls[2][0]).toBe('ROLLBACK');
      expect(client.release).toHaveBeenCalled();
    });

    it('activates a validated profile and deactivates the previous active row', async () => {
      const target = {
        id: 'p2', project_id: 1, version: 2, profile: validProfile(),
        profile_hash: 'h1', status: 'draft',
      };
      const activated = { ...target, status: 'active' };
      const client = clientWith([
        {}, // BEGIN
        { rows: [target] }, // target lock
        { rows: [{ exists: true }] }, // exact-content validation
        { rows: [{ id: 'p1' }] }, // deactivate old
        { rows: [activated] }, // activate target
        {}, // COMMIT
      ]);

      const result = await RepoProfileService.activate(1, 'p2', owner());

      expect(result.status).toBe('active');
      expect(client.query.mock.calls[2][0]).toContain("status = 'succeeded'");
      expect(client.query.mock.calls[3][0]).toContain("status = 'inactive'");
      expect(client.query.mock.calls[4][0]).toContain("status = 'active'");
      expect(client.release).toHaveBeenCalled();
      const event = pool.query.mock.calls.find(
        ([sql]) => String(sql).includes('INSERT INTO repo_profile_events')
      );
      expect(event[1][4]).toBe('activated');
      expect(JSON.parse(event[1][7])).toEqual({ previous_active_id: 'p1' });
    });



    it('backfills an already-active legacy profile hash without re-validating', async () => {
      const target = {
        id: 'p2', project_id: 1, version: 2, profile: validProfile(),
        profile_hash: null, status: 'active',
      };
      const client = clientWith([
        {}, // BEGIN
        { rows: [target] }, // target lock
        { rows: [] }, // hash update
        {}, // COMMIT
      ]);

      const result = await RepoProfileService.activate(1, 'p2', owner());

      expect(result.status).toBe('active');
      expect(result.profile_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(client.query.mock.calls[2][0]).toContain('SET profile_hash = $1');
      expect(client.query.mock.calls[3][0]).toBe('COMMIT');
    });

    it('persists a legacy profile hash before checking for validation evidence', async () => {
      const target = {
        id: 'p2', project_id: 1, version: 2, profile: validProfile(),
        profile_hash: null, status: 'draft',
      };
      const activated = { ...target, profile_hash: 'computed', status: 'active' };
      const client = clientWith([
        {}, // BEGIN
        { rows: [target] }, // target lock
        {}, // profile hash update
        { rows: [{ exists: true }] }, // exact-content validation
        { rows: [] }, // deactivate old
        { rows: [activated] }, // activate target
        {}, // COMMIT
      ]);

      const result = await RepoProfileService.activate(1, 'p2', owner());

      expect(result.status).toBe('active');
      expect(client.query.mock.calls[2][0]).toContain('SET profile_hash = $1');
      expect(client.query.mock.calls[2][1][0]).toMatch(/^[a-f0-9]{64}$/);
      expect(client.query.mock.calls[2][1][2]).toBe(1);
      expect(client.query.mock.calls[3][0]).toContain("status = 'succeeded'");
    });

    it('reactivates a previously active version for rollback', async () => {
      const target = {
        id: 'p1', project_id: 1, version: 1, profile: validProfile(),
        profile_hash: 'h1', status: 'inactive',
        activated_at: new Date('2026-01-01T00:00:00Z'),
      };
      const activated = { ...target, status: 'active' };
      const client = clientWith([
        {}, // BEGIN
        { rows: [target] }, // target lock
        { rows: [{ exists: true }] }, // exact-content validation
        { rows: [] }, // deactivate old
        { rows: [activated] }, // activate target
        {}, // COMMIT
      ]);

      const result = await RepoProfileService.activate(1, 'p1', owner());

      expect(result.status).toBe('active');
      expect(client.query.mock.calls[2][0]).toContain("status = 'succeeded'");
      expect(client.query.mock.calls[3][0]).toContain("status = 'inactive'");
      expect(client.query.mock.calls[4][0]).toContain("status = 'active'");
      expect(client.release).toHaveBeenCalled();
      const event = pool.query.mock.calls.find(
        ([sql]) => String(sql).includes('INSERT INTO repo_profile_events')
      );
      expect(event[1][4]).toBe('reactivated');
    });

    it('refuses to activate a retired draft that was never active', async () => {
      const target = {
        id: 'p1', project_id: 1, version: 1, profile: validProfile(),
        profile_hash: 'h1', status: 'inactive', activated_at: null,
      };
      const client = clientWith([
        {}, // BEGIN
        { rows: [target] }, // target lock
        {}, // ROLLBACK
      ]);

      await expect(RepoProfileService.activate(1, 'p1', owner()))
        .rejects.toThrow(/Only draft or previously active profiles/);
      expect(client.query.mock.calls[2][0]).toBe('ROLLBACK');
      expect(client.release).toHaveBeenCalled();
    });

    it('refuses to activate a profile without a successful exact-content validation', async () => {
      const target = {
        id: 'p2', project_id: 1, version: 2, profile: validProfile(),
        profile_hash: 'h1', status: 'draft',
      };
      const client = clientWith([
        {}, // BEGIN
        { rows: [target] }, // target lock
        { rows: [] }, // no matching successful validation
        {}, // ROLLBACK
      ]);

      await expect(RepoProfileService.activate(1, 'p2', owner()))
        .rejects.toThrow(/successful dry run/);
      expect(client.query.mock.calls[3][0]).toBe('ROLLBACK');
      expect(client.release).toHaveBeenCalled();
    });
  });

  describe('getCurrent', () => {
    it('returns the active profile and version history', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          { id: 'a', version: 2, status: 'active', profile: validProfile() },
          { id: 'b', version: 1, status: 'inactive', profile: validProfile() },
        ],
      });

      const result = await RepoProfileService.getCurrent(1, owner());

      expect(result.active.id).toBe('a');
      expect(result.latest.id).toBe('a');
      expect(result.versions).toHaveLength(2);
    });

    it('returns the editable draft as latest when an active profile exists', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          { id: 'a', version: 1, status: 'active', profile: validProfile() },
          { id: 'b', version: 2, status: 'draft', profile: validProfile() },
        ],
      });

      const result = await RepoProfileService.getCurrent(1, owner());

      expect(result.active.id).toBe('a');
      expect(result.latest.id).toBe('b');
      expect(result.latest.status).toBe('draft');
      expect(result.versions.map((row) => row.id)).toEqual(['a', 'b']);
    });
  });


    it('returns raw profiles to the owner and redacted profiles to members', async () => {
      const legacy = validProfile({ verify: ['mysql -uroot -psecret'] });
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'a', version: 1, status: 'active', profile: legacy }],
      });

      const ownerResult = await RepoProfileService.getCurrent(1, owner());
      expect(ownerResult.latest.profile.verify[0]).toContain('secret');

      pool.query
        .mockResolvedValueOnce({ rows: [{ user_id: 8 }] })
        .mockResolvedValueOnce({
          rows: [{ id: 'a', version: 1, status: 'active', profile: legacy }],
        });
      const memberResult = await RepoProfileService.getCurrent(
        1, { userId: 8, role: 'member' }
      );
      expect(memberResult.latest.profile.verify[0]).not.toContain('secret');
      expect(memberResult.latest.profile.verify[0]).toContain('[REDACTED]');
    });

    it('returns raw version history to the owner and redacted history to members', async () => {
      const legacy = validProfile({ setup: ['DB_PASS=secret npm ci'] });
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'a', version: 1, status: 'active', profile: legacy }],
      });

      const ownerRows = await RepoProfileService.listVersions(1, owner());
      expect(ownerRows[0].profile.setup[0]).toContain('secret');

      pool.query
        .mockResolvedValueOnce({ rows: [{ user_id: 8 }] })
        .mockResolvedValueOnce({
          rows: [{ id: 'a', version: 1, status: 'active', profile: legacy }],
        });
      const memberRows = await RepoProfileService.listVersions(
        1, { userId: 8, role: 'member' }
      );
      expect(memberRows[0].profile.setup[0]).not.toContain('secret');
      expect(memberRows[0].profile.setup[0]).toContain('[REDACTED]');
    });

  describe('listEvents', () => {
    it('returns paginated lifecycle events in newest-first order', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ id: '10', project_id: 1, action: 'activated' }],
      });

      const events = await RepoProfileService.listEvents(
        1, owner(), { limit: 50, offset: 10 }
      );

      expect(events).toHaveLength(1);
      expect(pool.query.mock.calls[0][0]).toContain('FROM repo_profile_events');
      expect(pool.query.mock.calls[0][0]).toContain('ORDER BY created_at DESC, id DESC');
      expect(pool.query.mock.calls[0][1]).toEqual([1, 50, 10]);
    });

    it('rejects invalid bounds', async () => {
      await expect(RepoProfileService.listEvents(1, owner(), { limit: 0 }))
        .rejects.toThrow(/limit must be an integer between 1 and 200/);
      await expect(RepoProfileService.listEvents(1, owner(), { offset: -1 }))
        .rejects.toThrow(/offset must be a non-negative integer/);
    });
  });

  describe('stack detection', () => {
    it('proposes a Node profile with a lockfile and non-watch vitest command', async () => {
      const files = {
        'package.json': JSON.stringify({
          scripts: { test: 'vitest', lint: 'eslint .' },
        }),
        'package-lock.json': '{}',
      };
      GitHubService.readRepoFile.mockImplementation(
        (projectId, file) => Promise.resolve(files[file] ?? null)
      );

      const result = await RepoProfileService.detectStack(1);

      expect(result.detected).toBe(true);
      expect(result.profile.languages).toEqual(['node']);
      expect(result.profile.setup).toEqual(['npm ci --no-audit --no-fund']);
      expect(result.profile.verify).toEqual(['npm test -- --run', 'npm run lint']);
    });

    it('does not add --run when the vitest script already runs once', async () => {
      const files = {
        'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }),
        'package-lock.json': '{}',
      };
      GitHubService.readRepoFile.mockImplementation(
        (projectId, file) => Promise.resolve(files[file] ?? null)
      );

      const result = await RepoProfileService.detectStack(1);

      expect(result.profile.verify).toEqual(['npm test']);
    });


    it('merges subpackage tests when the root only has lint/typecheck', async () => {
      const files = {
        'package.json': JSON.stringify({ scripts: { lint: 'eslint .' } }),
        'package-lock.json': '{}',
        'backend/package.json': JSON.stringify({ scripts: { test: 'jest' } }),
        'backend/package-lock.json': '{}',
      };
      GitHubService.readRepoFile.mockImplementation(
        (projectId, file) => Promise.resolve(files[file] ?? null)
      );

      const result = await RepoProfileService.detectStack(1);

      expect(result.profile.verify).toEqual([
        'npm run lint',
        'cd backend && npm test',
      ]);
    });

    it('detects backend/frontend monorepo packages', async () => {
      const files = {
        'backend/package.json': JSON.stringify({ scripts: { test: 'jest' } }),
        'backend/package-lock.json': '{}',
        'frontend/package.json': JSON.stringify({ scripts: { test: 'vitest run' } }),
      };
      GitHubService.readRepoFile.mockImplementation(
        (projectId, file) => Promise.resolve(files[file] ?? null)
      );

      const result = await RepoProfileService.detectStack(1);

      expect(result.profile.languages).toEqual(['node']);
      expect(result.profile.setup).toEqual([
        'cd backend && npm ci --no-audit --no-fund',
        'cd frontend && npm install --no-package-lock --no-audit --no-fund',
      ]);
      expect(result.profile.verify).toEqual([
        'cd backend && npm test',
        'cd frontend && npm test',
      ]);
    });

    it('falls back to workspace subpackages when the root package has no scripts', async () => {
      const files = {
        'package.json': JSON.stringify({ workspaces: ['backend'] }),
        'package-lock.json': '{}',
        'backend/package.json': JSON.stringify({ scripts: { test: 'jest' } }),
        'backend/package-lock.json': '{}',
      };
      GitHubService.readRepoFile.mockImplementation(
        (projectId, file) => Promise.resolve(files[file] ?? null)
      );

      const result = await RepoProfileService.detectStack(1);

      expect(result.detected).toBe(true);
      expect(result.profile.verify).toEqual(['cd backend && npm test']);
      expect(result.profile.setup).toEqual([
        'npm ci --no-audit --no-fund',
        'cd backend && npm ci --no-audit --no-fund',
      ]);
    });

    it('detects Java, Python and Go manifests', async () => {
      const files = {
        'pom.xml': '<project/>',
        'mvnw': '#!/bin/sh',
        'requirements.txt': 'pytest',
        'go.mod': 'module example',
      };
      GitHubService.readRepoFile.mockImplementation(
        (projectId, file) => Promise.resolve(files[file] ?? null)
      );

      const result = await RepoProfileService.detectStack(1);

      expect(result.profile.languages).toEqual(expect.arrayContaining(['java', 'python', 'go']));
      expect(result.profile.setup).toEqual(expect.arrayContaining([
        'pip install -r requirements.txt',
        'go mod download',
      ]));
      expect(result.profile.verify).toEqual(expect.arrayContaining([
        './mvnw test -q',
        'pytest -q',
        'go test ./...',
      ]));
    });

    it('proposes dependency caches for detected stacks', async () => {
      const files = {
        'package.json': JSON.stringify({ scripts: { test: 'jest' } }),
        'package-lock.json': '{}',
        'pom.xml': '<project/>',
        'requirements.txt': 'pytest',
        'go.mod': 'module example',
      };
      GitHubService.readRepoFile.mockImplementation(
        (projectId, file) => Promise.resolve(files[file] ?? null)
      );

      const result = await RepoProfileService.detectStack(1);

      expect(result.profile.caches).toEqual(
        expect.arrayContaining(['npm', 'maven', 'pip', 'go']));
    });

    it('warns when a Gradle project has no wrapper', async () => {
      const files = { 'build.gradle': 'plugins { id "java" }' };
      GitHubService.readRepoFile.mockImplementation(
        (projectId, file) => Promise.resolve(files[file] ?? null)
      );

      const result = await RepoProfileService.detectStack(1);

      expect(result.profile.languages).toEqual(['java']);
      expect(result.profile.verify).toEqual(['gradle test']);
      expect(result.warnings.join(' ')).toMatch(/no \.\/gradlew.*Maven.*not Gradle/);
    });

    it('uses the Gradle wrapper without warning when present', async () => {
      const files = {
        'build.gradle': 'plugins { id "java" }',
        'gradlew': '#!/bin/sh',
      };
      GitHubService.readRepoFile.mockImplementation(
        (projectId, file) => Promise.resolve(files[file] ?? null)
      );

      const result = await RepoProfileService.detectStack(1);

      expect(result.profile.verify).toEqual(['./gradlew test']);
      expect(result.warnings.join(' ')).not.toMatch(/no \.\/gradlew/);
    });

    it('warns instead of silently skipping verification when nothing is detected', async () => {
      const result = await RepoProfileService.detectStack(1);

      expect(result.detected).toBe(false);
      expect(result.profile.verify).toEqual([]);
      expect(result.warnings.join(' ')).toMatch(/add verify commands manually/);
    });

    it('proposes the configured pinned image for the detected stack', async () => {
      const image = `registry.example/vibecode-sandbox-node:latest@sha256:${'a'.repeat(64)}`;
      process.env.REPO_PROFILE_STACK_IMAGES = JSON.stringify({ node: image });
      const files = {
        'package.json': JSON.stringify({ scripts: { test: 'jest' } }),
        'package-lock.json': '{}',
      };
      GitHubService.readRepoFile.mockImplementation(
        (projectId, file) => Promise.resolve(files[file] ?? null)
      );

      try {
        const result = await RepoProfileService.detectStack(1);
        expect(result.profile.languages).toEqual(['node']);
        expect(result.profile.image).toBe(image);
        expect(result.warnings.join(' ')).not.toMatch(/No pinned stack image/);
      } finally {
        delete process.env.REPO_PROFILE_STACK_IMAGES;
      }
    });

    it('proposes the monorepo image when several languages are detected', async () => {
      const image = `registry.example/vibecode-sandbox-monorepo:latest@sha256:${'b'.repeat(64)}`;
      process.env.REPO_PROFILE_STACK_IMAGES = JSON.stringify({ monorepo: image });
      const files = {
        'package.json': JSON.stringify({ scripts: { test: 'jest' } }),
        'package-lock.json': '{}',
        'pom.xml': '<project/>',
      };
      GitHubService.readRepoFile.mockImplementation(
        (projectId, file) => Promise.resolve(files[file] ?? null)
      );

      try {
        const result = await RepoProfileService.detectStack(1);
        expect(result.profile.languages).toEqual(expect.arrayContaining(['node', 'java']));
        expect(result.profile.image).toBe(image);
      } finally {
        delete process.env.REPO_PROFILE_STACK_IMAGES;
      }
    });

    it('warns when no pinned stack image is configured', async () => {
      const files = {
        'package.json': JSON.stringify({ scripts: { test: 'jest' } }),
        'package-lock.json': '{}',
      };
      GitHubService.readRepoFile.mockImplementation(
        (projectId, file) => Promise.resolve(files[file] ?? null)
      );

      const result = await RepoProfileService.detectStack(1);

      expect(result.profile.image).toBeUndefined();
      expect(result.warnings.join(' ')).toMatch(/No pinned stack image/);
    });

    it('rejects an invalid stack-image configuration instead of guessing', async () => {
      process.env.REPO_PROFILE_STACK_IMAGES = '{"node":"node:24"}';
      const files = {
        'package.json': JSON.stringify({ scripts: { test: 'jest' } }),
        'package-lock.json': '{}',
      };
      GitHubService.readRepoFile.mockImplementation(
        (projectId, file) => Promise.resolve(files[file] ?? null)
      );

      try {
        await expect(RepoProfileService.detectStack(1))
          .rejects.toThrow(/pinned by digest/);
      } finally {
        delete process.env.REPO_PROFILE_STACK_IMAGES;
      }
    });

    it('requires a connected repository', async () => {
      GitHubService.getProjectRepo.mockResolvedValue(null);
      await expect(RepoProfileService.detectStack(1)).rejects.toThrow(/Connect a GitHub repository/);
    });
  });

  describe('origin CA validation', () => {
    const caPath = path.join(
      __dirname, '../../../agent/src/test/resources/egress-origin-ca.pem'
    );
    const leafPath = path.join(
      __dirname, '../../../agent/src/test/resources/egress-origin-leaf.pem'
    );

    it('accepts a CA bundle for exact hosts', async () => {
      const ca = fs.readFileSync(caPath);
      pool.connect.mockResolvedValueOnce({
        query: jest.fn()
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({ rows: [{ id: 1 }] })
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({ rows: [{ version: 1 }] })
          .mockResolvedValueOnce({ rows: [{ id: 'p1', version: 1, status: 'draft', profile: {} }] })
          .mockResolvedValueOnce({}),
        release: jest.fn(),
      });

      const profile = validProfile({
        egress: {
          tls_mode: 'terminate',
          origin_ca_hosts: ['registry.example.com'],
          origin_ca_b64: ca.toString('base64'),
        },
      });

      await expect(RepoProfileService.create(1, profile, owner())).resolves.toBeTruthy();
    });

    it('rejects a non-CA leaf certificate and private-key material', async () => {
      const leaf = fs.readFileSync(leafPath);
      await expect(RepoProfileService.create(1, validProfile({
        egress: {
          tls_mode: 'terminate',
          origin_ca_hosts: ['registry.example.com'],
          origin_ca_b64: leaf.toString('base64'),
        },
      }), owner())).rejects.toThrow(/CA certificates only/);

      const privateKey = Buffer.from('-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----')
        .toString('base64');
      await expect(RepoProfileService.create(1, validProfile({
        egress: {
          tls_mode: 'terminate',
          origin_ca_hosts: ['registry.example.com'],
          origin_ca_b64: privateKey,
        },
      }), owner())).rejects.toThrow(/private key/);
    });


    it('rejects non-canonical base64 (whitespace or URL-safe characters)', async () => {
      const ca = fs.readFileSync(caPath).toString('base64');
      const wrapped = ca.slice(0, 20) + '\n' + ca.slice(20);
      await expect(RepoProfileService.create(1, validProfile({
        egress: {
          tls_mode: 'terminate',
          origin_ca_hosts: ['registry.example.com'],
          origin_ca_b64: wrapped,
        },
      }), owner())).rejects.toThrow(/canonical base64/);

      await expect(RepoProfileService.create(1, validProfile({
        egress: {
          tls_mode: 'terminate',
          origin_ca_hosts: ['registry.example.com'],
          origin_ca_b64: 'YWJj-_==',
        },
      }), owner())).rejects.toThrow(/canonical base64/);
    });

    it('rejects wildcard, internal and IP hosts', async () => {
      const ca = fs.readFileSync(caPath).toString('base64');
      for (const host of ['*.example.com', 'localhost', '10.0.0.1', 'metadata.google.internal']) {
        await expect(RepoProfileService.create(1, validProfile({
          egress: {
            tls_mode: 'terminate',
            origin_ca_hosts: [host],
            origin_ca_b64: ca,
          },
        }), owner())).rejects.toThrow(/origin_ca_hosts/);
      }
    });
  });
});
