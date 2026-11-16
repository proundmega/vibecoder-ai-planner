jest.mock('../db', () => ({
  pool: { query: jest.fn() },
}));

jest.mock('../services/RepoProfileService', () => ({
  assertCanWrite: jest.fn(),
  assertCanRead: jest.fn(),
  assertAgentProjectAccess: jest.fn(),
  assertProfileRepoBinding: jest.fn(),
  profileHash: jest.fn(() => 'hash'),
}));

const RepoProfileValidationService = require('../services/RepoProfileValidationService');
const RepoProfileService = require('../services/RepoProfileService');
const { pool } = require('../db');
const { ConflictError, ForbiddenError } = require('../errors/HttpError');

const VALIDATION_ID = '22222222-2222-4222-8222-222222222222';
const PROFILE_ID = '11111111-1111-4111-8111-111111111111';

function profileRow(overrides = {}) {
  return {
    id: PROFILE_ID,
    project_id: 1,
    version: 3,
    profile: { schema_version: 1, verify: ['npm test'] },
    profile_hash: 'hash',
    status: 'draft',
    ...overrides,
  };
}

function validationRow(overrides = {}) {
  return {
    id: VALIDATION_ID,
    project_id: 1,
    profile_id: PROFILE_ID,
    profile_version: 3,
    profile: { schema_version: 1, verify: ['npm test'] },
    profile_hash: 'hash',
    status: 'queued',
    requested_by: 7,
    agent_id: null,
    result: {},
    error: null,
    created_at: '2026-11-16T00:00:00Z',
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

describe('RepoProfileValidationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
    RepoProfileService.assertCanWrite.mockResolvedValue({ id: 1, ownerId: 7 });
    RepoProfileService.assertCanRead.mockResolvedValue({ id: 1, ownerId: 7 });
    RepoProfileService.assertAgentProjectAccess.mockResolvedValue({ id: 1, ownerId: 7 });
    RepoProfileService.assertProfileRepoBinding.mockResolvedValue(undefined);
  });

  it('queues a validation with an immutable profile snapshot', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [profileRow()] })
      .mockResolvedValueOnce({ rows: [validationRow()] });

    const result = await RepoProfileValidationService.request(
      1, PROFILE_ID, { userId: 7, role: 'project_admin' }
    );

    expect(result.status).toBe('queued');
    expect(pool.query.mock.calls[1][0]).toContain('INSERT INTO repo_profile_validations');
    expect(pool.query.mock.calls[1][1]).toEqual([
      1,
      PROFILE_ID,
      3,
      JSON.stringify(profileRow().profile),
      'hash',
      7,
    ]);
  });


  it('persists a legacy profile hash when queuing validation', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [profileRow({ profile_hash: null })] })
      .mockResolvedValueOnce({ rows: [] }) // profile hash update
      .mockResolvedValueOnce({ rows: [validationRow({ profile_hash: 'hash' })] });

    const result = await RepoProfileValidationService.request(
      1, PROFILE_ID, { userId: 7, role: 'project_admin' }
    );

    expect(result.profile_hash).toBe('hash');
    expect(pool.query.mock.calls[1][0]).toContain('UPDATE repo_profiles');
    expect(pool.query.mock.calls[1][1]).toEqual(['hash', PROFILE_ID, 1]);
    expect(pool.query.mock.calls[2][0]).toContain('INSERT INTO repo_profile_validations');
  });

  it('requires the profile to still match the connected repository', async () => {
    pool.query.mockResolvedValueOnce({ rows: [profileRow()] });
    RepoProfileService.assertProfileRepoBinding.mockRejectedValueOnce(
      new (require('../errors/HttpError').ValidationError)('repo changed'));

    await expect(
      RepoProfileValidationService.request(1, PROFILE_ID, { userId: 7 })
    ).rejects.toThrow('repo changed');
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('rejects a duplicate queued/running validation', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [profileRow()] })
      .mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: '23505' }));

    await expect(
      RepoProfileValidationService.request(1, PROFILE_ID, { userId: 7 })
    ).rejects.toThrow(ConflictError);
  });

  it('reaps stale running validations before claiming the next queued one', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] }) // stale select
      .mockResolvedValueOnce({ rows: [validationRow({ status: 'running', agent_id: 9 })] });

    const result = await RepoProfileValidationService.claimNext(1, { id: 9, owner_id: 7 });

    expect(result.status).toBe('running');
    expect(pool.query.mock.calls[0][0]).toContain('SELECT id, profile, started_at');
    expect(pool.query.mock.calls[1][0]).toContain('FOR UPDATE SKIP LOCKED');
  });

  it('uses a stale budget at least as long as max_round_minutes', async () => {
    expect(RepoProfileValidationService.staleMinutesFor({ max_round_minutes: 120 }))
      .toBe(125);
    expect(RepoProfileValidationService.staleMinutesFor({ max_round_minutes: 45 }))
      .toBe(65);
    expect(RepoProfileValidationService.staleMinutesFor(null)).toBe(65);

    const old = new Date(Date.now() - 130 * 60_000).toISOString();
    const fresh = new Date(Date.now() - 65 * 60_000).toISOString();
    pool.query
      .mockResolvedValueOnce({
        rows: [
          { id: 'old', profile: { max_round_minutes: 120 }, started_at: old },
          { id: 'fresh', profile: { max_round_minutes: 120 }, started_at: fresh },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }) // stale select
      .mockResolvedValueOnce({ rows: [] }); // claim

    await RepoProfileValidationService.claimNext(1, { id: 9, owner_id: 7 });

    expect(pool.query.mock.calls[1][0]).toContain('UPDATE repo_profile_validations');
    expect(pool.query.mock.calls[1][1][1]).toContain('125-minute stale budget');
    expect(pool.query.mock.calls[2][0]).toContain('FOR UPDATE SKIP LOCKED');
  });

  it('returns null when no validation is queued', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      RepoProfileValidationService.claimNext(1, { id: 9, owner_id: 7 })
    ).resolves.toBeNull();
  });

  it('finishes a running validation for the claiming agent', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [validationRow({ status: 'running', agent_id: 9 })] })
      .mockResolvedValueOnce({
        rows: [validationRow({
          status: 'succeeded', agent_id: 9, result: { ok: true },
        })],
      });

    const result = await RepoProfileValidationService.finish(
      1, VALIDATION_ID, { id: 9, owner_id: 7 },
      { status: 'succeeded', result: { ok: true } }
    );

    expect(result.status).toBe('succeeded');
    expect(pool.query.mock.calls[1][0]).toContain('finished_at = NOW()');
  });

  it('returns the first terminal result on a retried finish', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [validationRow({ status: 'failed', agent_id: 9, error: 'boom' })],
    });

    const result = await RepoProfileValidationService.finish(
      1, VALIDATION_ID, { id: 9, owner_id: 7 },
      { status: 'succeeded', result: { ok: true } }
    );

    expect(result.status).toBe('failed');
    expect(result.error).toBe('boom');
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('rejects a finish from a different agent', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [validationRow({ status: 'running', agent_id: 10 })],
    });

    await expect(
      RepoProfileValidationService.finish(
        1, VALIDATION_ID, { id: 9, owner_id: 7 },
        { status: 'succeeded' }
      )
    ).rejects.toThrow(ForbiddenError);
  });

  it('rejects an oversized or non-object result', async () => {
    await expect(
      RepoProfileValidationService.finish(
        1, VALIDATION_ID, { id: 9, owner_id: 7 },
        { status: 'succeeded', result: 'nope' }
      )
    ).rejects.toThrow(/JSON object/);

    await expect(
      RepoProfileValidationService.finish(
        1, VALIDATION_ID, { id: 9, owner_id: 7 },
        { status: 'succeeded', result: { output: 'x'.repeat(1024 * 1024 + 1) } }
      )
    ).rejects.toThrow(/1 MiB/);
  });

  it('hides validation details from non-members', async () => {
    RepoProfileService.assertCanRead.mockRejectedValueOnce(new ForbiddenError('no'));
    await expect(
      RepoProfileValidationService.get(1, VALIDATION_ID, { userId: 8 })
    ).rejects.toThrow(ForbiddenError);
  });

  it('returns the bounded validation history', async () => {
    pool.query.mockResolvedValueOnce({ rows: [validationRow()] });
    const rows = await RepoProfileValidationService.list(1, { userId: 7 });
    expect(rows).toHaveLength(1);
    expect(pool.query.mock.calls[0][0]).toContain('LIMIT 50');
  });
});
