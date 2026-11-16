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
