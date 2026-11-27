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
  let runtimeId;
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

    const credential = await pool.query(
      `INSERT INTO provider_credentials
         (owner_id, name, provider_type, api_key_encrypted)
       VALUES ($1, $2, 'openai', 'x') RETURNING id`,
      [ownerId, `repo-profile-cred-${suffix}`]
    );
    const model = await pool.query(
      `INSERT INTO provider_models (credential_id, model, source, roles)
       VALUES ($1, $2, 'manual', ARRAY['worker']) RETURNING id`,
      [credential.rows[0].id, `repo-profile-model-${suffix}`]
    );
    const node = await pool.query(
      `INSERT INTO agent_nodes (owner_id, name) VALUES ($1, $2) RETURNING id`,
      [ownerId, `repo-profile-node-${suffix}`]
    );
    const runtime = await pool.query(
      `INSERT INTO agent_runtimes
         (node_id, name, role, model_id, status, current_project_id)
       VALUES ($1, 'worker-1', 'worker', $2, 'running', $3) RETURNING id`,
      [node.rows[0].id, model.rows[0].id, projectId]
    );
    runtimeId = runtime.rows[0].id;
    agent = { id: runtimeId, owner_id: ownerId, _node: true };
  });

  afterAll(async () => {
    await pool.query('DELETE FROM project_credentials WHERE project_id = $1', [projectId]);
    await pool.query(
      `DELETE FROM agent_runtimes
       WHERE node_id IN (SELECT id FROM agent_nodes WHERE owner_id = $1)`,
      [ownerId]
    );
    await pool.query('DELETE FROM agent_nodes WHERE owner_id = $1', [ownerId]);
    await pool.query(
      `DELETE FROM provider_models
       WHERE credential_id IN (SELECT id FROM provider_credentials WHERE owner_id = $1)`,
      [ownerId]
    );
    await pool.query('DELETE FROM provider_credentials WHERE owner_id = $1', [ownerId]);
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
    const claimed = await RepoProfileValidationService.claimNext(projectId, agent, runtimeId);
    expect(claimed.id).toBe(queued.id);
    await RepoProfileValidationService.finish(projectId, claimed.id, agent, {
      status: 'succeeded',
      result: { commands: [] },
    }, runtimeId);
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

    const claimed = await RepoProfileValidationService.claimNext(projectId, agent, runtimeId);
    expect(claimed).toMatchObject({ id: queued.id, status: 'running', runtime_id: runtimeId });

    const finished = await RepoProfileValidationService.finish(
      projectId, claimed.id, agent, { status: 'succeeded', result: { commands: [] } }, runtimeId
    );
    expect(finished.status).toBe('succeeded');

    await pool.query('DELETE FROM repo_profiles WHERE project_id = $1', [projectId]);
  });

  test('paginates validation history with a stable id tie-breaker', async () => {
    const draft = await RepoProfileService.create(projectId, profile(), {
      userId: ownerId, role: 'project_admin',
    });
    try {
      await pool.query(
        `INSERT INTO repo_profile_validations
           (project_id, profile_id, profile_version, profile, profile_hash,
            status, requested_by, result, created_at)
         SELECT $1, $2, $3, $4, $5, 'succeeded', $6, '{}'::jsonb,
                NOW() - (i || ' seconds')::interval
         FROM generate_series(0, 200) AS i`,
        [projectId, draft.id, draft.version, draft.profile, draft.profile_hash, ownerId]
      );
      await pool.query(
        `UPDATE repo_profile_validations
         SET created_at = NOW()
         WHERE id IN (
           SELECT id FROM repo_profile_validations
           WHERE project_id = $1
           ORDER BY created_at DESC, id DESC
           LIMIT 5
         )`,
        [projectId]
      );

      const first = await RepoProfileValidationService.list(
        projectId, { userId: ownerId, role: 'project_admin' },
        { limit: 200, offset: 0 });
      const second = await RepoProfileValidationService.list(
        projectId, { userId: ownerId, role: 'project_admin' },
        { limit: 200, offset: 200 });

      expect(first).toHaveLength(200);
      expect(second).toHaveLength(1);
      expect(first.some((row) => row.id === second[0].id)).toBe(false);
      expect(new Date(second[0].created_at).getTime())
        .toBeLessThanOrEqual(new Date(first[199].created_at).getTime());

      const tied = first.slice(0, 5).map((row) => String(row.id));
      expect(tied).toEqual([...tied].sort().reverse());
    } finally {
      await pool.query('DELETE FROM repo_profiles WHERE project_id = $1', [projectId]);
    }
  });

  test('enforces one draft per project', async () => {
    const first = await RepoProfileService.create(projectId, profile(), {
      userId: ownerId, role: 'project_admin',
    });
    const second = await RepoProfileService.create(projectId, profile({ verify: ['npm run lint'] }), {
      userId: ownerId, role: 'project_admin',
    });

    const rows = await pool.query(
      `SELECT id, status, version FROM repo_profiles
       WHERE project_id = $1 ORDER BY version`,
      [projectId]
    );
    expect(rows.rows).toEqual([
      { id: first.id, status: 'inactive', version: first.version },
      { id: second.id, status: 'draft', version: second.version },
    ]);
    const drafts = await pool.query(
      `SELECT count(*)::int AS count FROM repo_profiles
       WHERE project_id = $1 AND status = 'draft'`,
      [projectId]
    );
    expect(drafts.rows[0].count).toBe(1);
    await expect(RepoProfileService.activate(projectId, first.id, {
      userId: ownerId, role: 'project_admin',
    })).rejects.toThrow(/Only draft or previously active profiles can be activated/);
    await expect(RepoProfileValidationService.request(projectId, first.id, {
      userId: ownerId, role: 'project_admin',
    })).rejects.toThrow(/Retired drafts cannot queue a new validation/);
    const index = await pool.query(
      "SELECT 1 FROM pg_indexes WHERE indexname = 'uq_repo_profiles_draft'"
    );
    expect(index.rows).toHaveLength(1);
    await expect(pool.query(
      `INSERT INTO repo_profiles
         (project_id, version, profile, profile_hash, status)
       VALUES ($1, 99, '{}'::jsonb, 'h', 'draft')`,
      [projectId]
    )).rejects.toThrow(/duplicate key value violates unique constraint/);

    await pool.query('DELETE FROM repo_profiles WHERE project_id = $1', [projectId]);
  });

  test('migration 065 retires older drafts and keeps the newest', async () => {
    await pool.query('DELETE FROM repo_profiles WHERE project_id = $1', [projectId]);
    const client = await pool.connect();
    try {
      // Keep the temporary index drop and backfill inside one transaction so
      // the test never leaves the shared suite without the unique index.
      await client.query('BEGIN');
      await client.query('DROP INDEX IF EXISTS uq_repo_profiles_draft');
      for (const version of [1, 2, 3]) {
        await client.query(
          `INSERT INTO repo_profiles
             (project_id, version, profile, profile_hash, status)
           VALUES ($1, $2, $3::jsonb, $4, 'draft')`,
          [
            projectId,
            version,
            JSON.stringify(profile({ verify: [`run-${version}`] })),
            `h${version}`,
          ]
        );
      }

      const sql = fs.readFileSync(
        path.join(__dirname, '../../migrations/065_repo_profile_single_draft.sql'),
        'utf8'
      );
      await client.query(sql);

      const rows = await client.query(
        `SELECT version, status FROM repo_profiles
         WHERE project_id = $1 ORDER BY version`,
        [projectId]
      );
      expect(rows.rows).toEqual([
        { version: 1, status: 'inactive' },
        { version: 2, status: 'inactive' },
        { version: 3, status: 'draft' },
      ]);
      await expect(client.query(
        `INSERT INTO repo_profiles
           (project_id, version, profile, profile_hash, status)
         VALUES ($1, 4, '{}'::jsonb, 'h4', 'draft')`,
        [projectId]
      )).rejects.toThrow(/duplicate key value violates unique constraint/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  test('rolls back to a previous active version and exposes the current draft', async () => {
    const v1 = await RepoProfileService.create(projectId, profile(), {
      userId: ownerId, role: 'project_admin',
    });
    await validateAndActivate(v1.id);
    const v2 = await RepoProfileService.create(
      projectId, profile({ verify: ['npm run lint'] }),
      { userId: ownerId, role: 'project_admin' }
    );
    await validateAndActivate(v2.id);

    const rolledBack = await RepoProfileService.activate(projectId, v1.id, {
      userId: ownerId, role: 'project_admin',
    });
    expect(rolledBack.status).toBe('active');
    const statuses = await pool.query(
      `SELECT id, status, activated_at FROM repo_profiles
       WHERE project_id = $1 ORDER BY version`,
      [projectId]
    );
    expect(statuses.rows.map((row) => [row.id, row.status])).toEqual([
      [v1.id, 'active'],
      [v2.id, 'inactive'],
    ]);
    expect(statuses.rows[1].activated_at).not.toBeNull();

    const v3 = await RepoProfileService.create(
      projectId, profile({ verify: ['npm run build'] }),
      { userId: ownerId, role: 'project_admin' }
    );
    const current = await RepoProfileService.getCurrent(projectId, {
      userId: ownerId, role: 'project_admin',
    });
    expect(current.active.id).toBe(v1.id);
    expect(current.latest.id).toBe(v3.id);
    expect(current.latest.status).toBe('draft');

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

    const claimed = await RepoProfileValidationService.claimNext(projectId, agent, runtimeId);
    await RepoProfileValidationService.finish(projectId, claimed.id, agent, {
      status: 'succeeded',
      result: { commands: [] },
    }, runtimeId);

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
