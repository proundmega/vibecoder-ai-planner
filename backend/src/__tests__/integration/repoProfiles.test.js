const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const RepoProfileService = require('../../services/RepoProfileService');
const RepoProfileValidationService = require('../../services/RepoProfileValidationService');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

describe('Repo profiles — PostgreSQL integration (fg-39)', () => {
  let ownerId;
  let projectId;
  let noRepoProjectId;
  let agentId;
  let agent;

  beforeAll(async () => {
    const owner = await pool.query(
      `INSERT INTO users (email, name, password_hash, role)
       VALUES ($1, 'Repo Profile Owner', 'x', 'project_admin') RETURNING id`,
      [`repo_profile_owner_${suffix}@test.com`]
    );
    ownerId = owner.rows[0].id;

    const project = await pool.query(
      `INSERT INTO projects (name, owner_id) VALUES ($1, $2) RETURNING id`,
      [`Repo Profile Project ${suffix}`, ownerId]
    );
    projectId = project.rows[0].id;

    const noRepoProject = await pool.query(
      `INSERT INTO projects (name, owner_id) VALUES ($1, $2) RETURNING id`,
      [`Repo Profile No Repo ${suffix}`, ownerId]
    );
    noRepoProjectId = noRepoProject.rows[0].id;

    await pool.query(
      `INSERT INTO project_repos
         (project_id, provider, repo_url, access_token_encrypted, default_branch, is_active)
       VALUES ($1, 'github', $2, NULL, 'main', TRUE)`,
      [projectId, `https://github.com/acme/repo-${suffix}.git`]
    );

    const agentRow = await pool.query(
      `INSERT INTO agents (name, api_key_hash, owner_id)
       VALUES ($1, 'hash', $2) RETURNING id, owner_id`,
      [`repo-profile-agent-${suffix}`, ownerId]
    );
    agentId = agentRow.rows[0].id;
    agent = { id: agentId, owner_id: ownerId };
  });

  afterAll(async () => {
    await pool.query('DELETE FROM project_credentials WHERE project_id = $1', [projectId]);
    await pool.query('DELETE FROM users WHERE id = $1', [ownerId]);
    await pool.end();
  });

  const profile = (overrides = {}) => ({
    schema_version: 1,
    repo_url: `https://github.com/acme/repo-${suffix}`,
    base_branch: 'main',
    languages: ['node'],
    setup: [],
    verify: ['npm test'],
    caches: [],
    env: {},
    timeouts: { setup_minutes: 5, verify_minutes: 5 },
    max_round_minutes: 10,
    services: [],
    flaky_tests: [],
    ...overrides,
  });

  async function validateAndActivate(profileId) {
    const queued = await RepoProfileValidationService.request(projectId, profileId, {
      userId: ownerId, role: 'project_admin',
    });
    const claimed = await RepoProfileValidationService.claimNext(projectId, agent);
    expect(claimed.id).toBe(queued.id);
    await RepoProfileValidationService.finish(projectId, claimed.id, agent, {
      status: 'succeeded',
      result: { commands: [] },
    });
    return RepoProfileService.activate(projectId, profileId, {
      userId: ownerId, role: 'project_admin',
    });
  }

  test('migration 050 supports versioned profiles and dry-run evidence', async () => {
    const draft = await RepoProfileService.create(projectId, profile(), {
      userId: ownerId, role: 'project_admin',
    });
    expect(draft.status).toBe('draft');
    expect(draft.profile_hash).toMatch(/^[a-f0-9]{64}$/);

    const queued = await RepoProfileValidationService.request(projectId, draft.id, {
      userId: ownerId, role: 'project_admin',
    });
    expect(queued.status).toBe('queued');
    expect(queued.profile_hash).toBe(draft.profile_hash);

    const claimed = await RepoProfileValidationService.claimNext(projectId, agent);
    expect(claimed).toMatchObject({ id: queued.id, status: 'running', agent_id: agentId });

    const finished = await RepoProfileValidationService.finish(
      projectId, claimed.id, agent, { status: 'succeeded', result: { commands: [] } }
    );
    expect(finished.status).toBe('succeeded');

    await pool.query('DELETE FROM repo_profiles WHERE project_id = $1', [projectId]);
  });

  test('activation requires a successful dry run for the exact content', async () => {
    const draft = await RepoProfileService.create(projectId, profile(), {
      userId: ownerId, role: 'project_admin',
    });

    await expect(RepoProfileService.activate(projectId, draft.id, {
      userId: ownerId, role: 'project_admin',
    })).rejects.toThrow(/successful dry run/);

    const active = await validateAndActivate(draft.id);
    expect(active.status).toBe('active');

    const next = await RepoProfileService.create(projectId, profile({ verify: ['npm run lint'] }), {
      userId: ownerId, role: 'project_admin',
    });
    expect(next.version).toBe(2);

    await expect(RepoProfileService.activate(projectId, next.id, {
      userId: ownerId, role: 'project_admin',
    })).rejects.toThrow(/successful dry run/);

    await validateAndActivate(next.id);
    await pool.query('DELETE FROM repo_profiles WHERE project_id = $1', [projectId]);
  });


  test('a legacy profile without a hash can be validated and activated', async () => {
    const draft = await RepoProfileService.create(projectId, profile(), {
      userId: ownerId, role: 'project_admin',
    });
    await pool.query(
      'UPDATE repo_profiles SET profile_hash = NULL WHERE id = $1',
      [draft.id]
    );

    const queued = await RepoProfileValidationService.request(projectId, draft.id, {
      userId: ownerId, role: 'project_admin',
    });
    expect(queued.profile_hash).toMatch(/^[a-f0-9]{64}$/);

    const persisted = await pool.query(
      'SELECT profile_hash FROM repo_profiles WHERE id = $1',
      [draft.id]
    );
    expect(persisted.rows[0].profile_hash).toBe(queued.profile_hash);

    const claimed = await RepoProfileValidationService.claimNext(projectId, agent);
    await RepoProfileValidationService.finish(projectId, claimed.id, agent, {
      status: 'succeeded',
      result: { commands: [] },
    });

    const active = await RepoProfileService.activate(projectId, draft.id, {
      userId: ownerId, role: 'project_admin',
    });
    expect(active.status).toBe('active');
    await pool.query('DELETE FROM repo_profiles WHERE project_id = $1', [projectId]);
  });

  test('mTLS credential material round-trips through storage and the exact profile revision', async () => {
    const cert = fs.readFileSync(
      path.join(__dirname, 'fixtures/egress-client-cert.pem'),
      'utf8'
    );
    const key = fs.readFileSync(
      path.join(__dirname, 'fixtures/egress-client-key.pem'),
      'utf8'
    );
    const credential = await RepoProfileService.createMtlsCredential(projectId, {
      name: `registry-client-${suffix}`,
      hosts: ['registry.example.com', 'other.example.com'],
      cert_b64: Buffer.from(cert).toString('base64'),
      key_b64: Buffer.from(key).toString('base64'),
    }, { userId: ownerId, role: 'project_admin' });

    const draft = await RepoProfileService.create(projectId, profile({
      egress: {
        tls_mode: 'terminate',
        mtls: {
          credential_id: credential.id,
          hosts: ['registry.example.com'],
        },
      },
    }), { userId: ownerId, role: 'project_admin' });

    await validateAndActivate(draft.id);
    const material = await RepoProfileService.getMtlsMaterialForAgent(
      projectId, agent, draft.id, draft.version);

    expect(material.profile_id).toBe(draft.id);
    expect(material.profile_version).toBe(draft.version);
    expect(typeof material.credential_id).toBe('string');
    expect(material.credential_id).toBe(credential.id);
    expect(material.hosts).toEqual(['registry.example.com']);
    expect(material.cert_b64).toBe(Buffer.from(cert).toString('base64'));
    expect(Buffer.from(material.cert_b64, 'base64').toString('utf8')).toBe(cert);
    expect(Buffer.from(material.key_b64, 'base64').toString('utf8')).toBe(key);

    await pool.query('DELETE FROM repo_profiles WHERE project_id = $1', [projectId]);
  });

  test('service definitions round-trip through storage and activation', async () => {
    const service = {
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
    };

    const draft = await RepoProfileService.create(projectId, profile({
      services: [service],
    }), { userId: ownerId, role: 'project_admin' });

    expect(draft.profile.services).toEqual([
      { ...service, healthcheck: { ...service.healthcheck, start_period_seconds: 0 } },
    ]);

    const active = await validateAndActivate(draft.id);
    expect(active.status).toBe('active');
    expect(active.profile.services).toEqual([
      { ...service, healthcheck: { ...service.healthcheck, start_period_seconds: 0 } },
    ]);
    expect(JSON.stringify(active.profile)).not.toContain('POSTGRES_PASSWORD=');

    await pool.query('DELETE FROM repo_profiles WHERE project_id = $1', [projectId]);
  });

  test('service definitions with a literal password are rejected before storage', async () => {
    const before = await pool.query(
      'SELECT count(*)::int AS count FROM repo_profiles WHERE project_id = $1',
      [projectId]
    );
    await expect(RepoProfileService.create(projectId, profile({
      services: [{
        name: 'postgres',
        image: `postgres@sha256:${'a'.repeat(64)}`,
        env: { POSTGRES_USER: 'vibecode' },
        connection_env: 'DATABASE_URL',
        connection_url: 'postgresql://vibecode:hunter2@${host}:5432/test',
        healthcheck: { command: 'pg_isready' },
      }],
    }), { userId: ownerId, role: 'project_admin' }))
      .rejects.toThrow(/literal password/);

    const after = await pool.query(
      'SELECT count(*)::int AS count FROM repo_profiles WHERE project_id = $1',
      [projectId]
    );
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  test('a project without an active repository cannot create a profile', async () => {
    await expect(RepoProfileService.create(noRepoProjectId, profile(), {
      userId: ownerId, role: 'project_admin',
    })).rejects.toThrow(/Connect an active repository/);
  });

  test('a profile cannot point at a different repository', async () => {
    await expect(RepoProfileService.create(
      projectId,
      profile({ repo_url: 'https://github.com/other/repo' }),
      { userId: ownerId, role: 'project_admin' }
    )).rejects.toThrow(/must match the repository connected/);
  });
});
