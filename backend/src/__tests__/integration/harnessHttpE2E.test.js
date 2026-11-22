process.env.JWT_SECRET = process.env.JWT_SECRET
  || 'bt60-e2e-jwt-secret-key-at-least-32-chars';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const crypto = require('crypto');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const app = require('../../index');
const { getSecret } = require('../../utils/jwt');
const {
  pool,
  createHarnessFixture,
  cleanupHarnessFixture,
  residualRows,
  closeHarnessFixturePool,
} = require('./harnessE2EFixtures');

/**
 * bt-60 Phase A — real Express app + real Postgres round trip for the durable
 * harness. No route or service is mocked.
 *
 * Covered: E1-E14 and E23-E24. E25 is review-only (the index lives outside the
 * backend test image and is updated in the planning docs). E26-E28 are
 * review/verification rows: this change adds test files only (E26), the
 * commands below plus lint are the evidence for E27, and E28 (staging safety)
 * belongs to the deferred Phase B staging run.
 *
 * E15-E21 (real OpenCode/GitHub/PR, crash/reaper/idempotent publish) remain
 * Phase B/manual and are recorded in the bt-60 runbook and deferred register.
 */

const BRANCH_PREFIX = 'bt60-e2e';

jest.setTimeout(30000);

let fixture;

function tokenFor(userId, role) {
  return jwt.sign(
    { userId, email: `bt60_${userId}@bt60.test`, role },
    getSecret(),
    { expiresIn: '15m' }
  );
}

function startRun({ token, runtimeId, ticketId, branch }) {
  return request(app)
    .post('/api/v1/harness/runs')
    .set('X-API-Key', token)
    .set('X-Agent-Runtime', String(runtimeId))
    .send({ ticketId, branch: branch || `${BRANCH_PREFIX}/${crypto.randomUUID()}` });
}

function claimLease({ token, runtimeId, ticketId, runId, ttlSeconds }) {
  return request(app)
    .post('/api/v1/harness/leases')
    .set('X-API-Key', token)
    .set('X-Agent-Runtime', String(runtimeId))
    .send({ ticketId, runId, ttlSeconds });
}

function renewLease({ token, runtimeId, ticketId, runId, ttlSeconds }) {
  return request(app)
    .post(`/api/v1/harness/leases/${ticketId}/renew`)
    .set('X-API-Key', token)
    .set('X-Agent-Runtime', String(runtimeId))
    .send({ runId, ttlSeconds });
}

function releaseLease({ token, runtimeId, ticketId, runId }) {
  return request(app)
    .delete(`/api/v1/harness/leases/${ticketId}`)
    .set('X-API-Key', token)
    .set('X-Agent-Runtime', String(runtimeId))
    .send({ runId });
}

function checkpoint({ token, runtimeId, runId, step, payload }) {
  return request(app)
    .post(`/api/v1/harness/runs/${runId}/checkpoints`)
    .set('X-API-Key', token)
    .set('X-Agent-Runtime', String(runtimeId))
    .send({ step, payload });
}

function heartbeat({ token, runtimeId, runId, step }) {
  return request(app)
    .post(`/api/v1/harness/runs/${runId}/heartbeat`)
    .set('X-API-Key', token)
    .set('X-Agent-Runtime', String(runtimeId))
    .send({ step });
}

function finishRun({ token, runtimeId, runId, status, headSha, prUrl, error }) {
  return request(app)
    .post(`/api/v1/harness/runs/${runId}/finish`)
    .set('X-API-Key', token)
    .set('X-Agent-Runtime', String(runtimeId))
    .send({ status, headSha, prUrl, error });
}

function getRun({ token, runtimeId, runId }) {
  return request(app)
    .get(`/api/v1/harness/runs/${runId}`)
    .set('X-API-Key', token)
    .set('X-Agent-Runtime', String(runtimeId));
}

async function dbRun(runId) {
  const result = await pool.query('SELECT * FROM harness_runs WHERE id = $1', [runId]);
  return result.rows[0];
}

async function count(sql, params) {
  const result = await pool.query(sql, params);
  return Number(result.rows[0].count);
}

async function createActiveRun(overrides = {}) {
  const response = await startRun({
    token: overrides.token || fixture.nodeToken,
    runtimeId: overrides.runtimeId || fixture.runtimeId,
    ticketId: overrides.ticketId || fixture.ticketId,
  });
  expect(response.statusCode).toBe(201);
  return response.body.data.id;
}

async function resetFixtureTickets() {
  await pool.query(
    'DELETE FROM harness_runs WHERE ticket_id = ANY($1::bigint[])',
    [fixture.ticketIds]
  );
  await pool.query(
    `UPDATE tickets
     SET status = 'in_progress', assigned_runtime_id = $2, pr_url = NULL, locked_at = NULL
     WHERE id = $1`,
    [fixture.ticketId, fixture.runtimeId]
  );
  await pool.query(
    `UPDATE tickets
     SET status = 'backlog', assigned_runtime_id = $2, pr_url = NULL, locked_at = NULL
     WHERE id = $1`,
    [fixture.backlogTicketId, fixture.runtimeId]
  );
  await pool.query(
    `UPDATE tickets
     SET status = 'in_progress', assigned_runtime_id = $2, pr_url = NULL, locked_at = NULL
     WHERE id = $1`,
    [fixture.otherTicketId, fixture.otherRuntimeId]
  );
}

beforeAll(async () => {
  fixture = await createHarnessFixture();
});

afterEach(async () => {
  if (!fixture) return;
  await resetFixtureTickets();
});

function fixtureIdsForCleanup(value) {
  return {
    suffix: value.suffix,
    userIds: value.userIds,
    projectIds: value.projectIds,
    nodeIds: value.nodeIds,
    runtimeIds: value.runtimeIds,
    ticketIds: value.ticketIds,
  };
}

afterAll(async () => {
  try {
    if (!fixture) return;
    try {
      await cleanupHarnessFixture(fixture);
      const residuals = await residualRows(fixture);
      const remaining = Object.entries(residuals).filter(([, value]) => value !== 0);
      if (remaining.length > 0) {
        throw new Error(`bt-60 fixture cleanup left rows: ${JSON.stringify(residuals)}`);
      }
    } catch (error) {
      // Ids only (never tokens) so the runbook cleanup SQL can target the run.
      console.error('bt-60 manual cleanup ids:', fixtureIdsForCleanup(fixture));
      throw error;
    }
  } finally {
    await closeHarnessFixturePool();
  }
});

describe('harness HTTP e2e (real app + real Postgres)', () => {
  test('E1 node runtime starts a run for its assigned in_progress ticket', async () => {
    const response = await startRun({
      token: fixture.nodeToken,
      runtimeId: fixture.runtimeId,
      ticketId: fixture.ticketId,
      branch: `${BRANCH_PREFIX}/e1`,
    });

    expect(response.statusCode).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('running');
    expect(response.body.data.step).toBe('created');
    expect(response.body.data.attempt).toBe(1);
    expect(response.body.data.ticket_id).toBe(String(fixture.ticketId));
    expect(response.body.data.runtime_id).toBe(String(fixture.runtimeId));

    const run = await dbRun(response.body.data.id);
    expect(run).toBeDefined();
    expect(run.status).toBe('running');
    expect(run.step).toBe('created');
    expect(run.attempt).toBe(1);
    expect(run.ticket_id).toBe(String(fixture.ticketId));
    expect(run.runtime_id).toBe(String(fixture.runtimeId));
    expect(run.project_id).toBe(String(fixture.projectId));
  });

  test('E2 duplicate start while a run is active returns 409 and keeps one run', async () => {
    const first = await startRun({
      token: fixture.nodeToken,
      runtimeId: fixture.runtimeId,
      ticketId: fixture.ticketId,
    });
    expect(first.statusCode).toBe(201);

    const second = await startRun({
      token: fixture.nodeToken,
      runtimeId: fixture.runtimeId,
      ticketId: fixture.ticketId,
    });
    expect(second.statusCode).toBe(409);
    expect(second.body.success).toBe(false);
    expect(second.body.error.code).toBe('CONFLICT');

    const active = await count(
      "SELECT count(*)::int AS count FROM harness_runs WHERE ticket_id = $1 AND status = 'running'",
      [fixture.ticketId]
    );
    expect(active).toBe(1);
  });

  test('E3 wrong runtime, cross-tenant runtime or wrong ticket status is rejected', async () => {
    const wrongRuntime = await startRun({
      token: fixture.nodeToken,
      runtimeId: fixture.secondRuntimeId,
      ticketId: fixture.ticketId,
    });
    expect(wrongRuntime.statusCode).toBe(403);

    const wrongTenant = await startRun({
      token: fixture.otherNodeToken,
      runtimeId: fixture.otherRuntimeId,
      ticketId: fixture.ticketId,
    });
    expect(wrongTenant.statusCode).toBe(403);

    const wrongStatus = await startRun({
      token: fixture.nodeToken,
      runtimeId: fixture.runtimeId,
      ticketId: fixture.backlogTicketId,
      branch: `${BRANCH_PREFIX}/e3-backlog`,
    });
    expect(wrongStatus.statusCode).toBe(403);

    expect(await count(
      'SELECT count(*)::int AS count FROM harness_runs WHERE ticket_id = ANY($1::bigint[])',
      [[fixture.ticketId, fixture.backlogTicketId]]
    )).toBe(0);
  });

  test('E4 a JWT cannot mutate a run (runtime identity required)', async () => {
    const ownerToken = tokenFor(fixture.ownerId, 'project_admin');

    const start = await request(app)
      .post('/api/v1/harness/runs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ticketId: fixture.ticketId, branch: `${BRANCH_PREFIX}/e4` });
    expect(start.statusCode).toBe(403);
    expect(start.body.error.code).toBe('FORBIDDEN');

    const runId = await createActiveRun();
    const write = await request(app)
      .post(`/api/v1/harness/runs/${runId}/checkpoints`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ step: 'cloned', payload: {} });
    expect(write.statusCode).toBe(403);
    expect(write.body.error.code).toBe('FORBIDDEN');
  });

  test('E5 missing, invalid and revoked node credentials return 401', async () => {
    const missing = await request(app)
      .post('/api/v1/harness/runs')
      .send({ ticketId: fixture.ticketId, branch: `${BRANCH_PREFIX}/e5-missing` });
    expect(missing.statusCode).toBe(401);

    const invalid = await startRun({
      token: `at_${'x'.repeat(48)}`,
      runtimeId: fixture.runtimeId,
      ticketId: fixture.ticketId,
    });
    expect(invalid.statusCode).toBe(401);
    expect(invalid.body.error.code).toBe('UNAUTHORIZED');

    const revoked = await startRun({
      token: fixture.revokedNodeToken,
      runtimeId: fixture.revokedRuntimeId,
      ticketId: fixture.ticketId,
    });
    expect(revoked.statusCode).toBe(401);
    expect(revoked.body.error.code).toBe('TOKEN_REVOKED');
  });

  test('E6 claim lease and block a second runtime', async () => {
    const runId = await createActiveRun();

    const claimed = await claimLease({
      token: fixture.nodeToken,
      runtimeId: fixture.runtimeId,
      ticketId: fixture.ticketId,
      runId,
      ttlSeconds: 120,
    });
    expect(claimed.statusCode).toBe(201);
    expect(claimed.body.success).toBe(true);
    expect(claimed.body.data.ticket_id).toBe(String(fixture.ticketId));
    expect(claimed.body.data.run_id).toBe(runId);
    expect(claimed.body.data.runtime_id).toBe(String(fixture.runtimeId));

    const conflict = await claimLease({
      token: fixture.nodeToken,
      runtimeId: fixture.secondRuntimeId,
      ticketId: fixture.ticketId,
      runId,
      ttlSeconds: 120,
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.body.error.code).toBe('CONFLICT');

    expect(await count(
      'SELECT count(*)::int AS count FROM harness_leases WHERE ticket_id = $1',
      [fixture.ticketId]
    )).toBe(1);
  });

  test('E7 renew, reassign and release the lease', async () => {
    const runId = await createActiveRun();
    const claimed = await claimLease({
      token: fixture.nodeToken,
      runtimeId: fixture.runtimeId,
      ticketId: fixture.ticketId,
      runId,
      ttlSeconds: 120,
    });
    expect(claimed.statusCode).toBe(201);

    const renewed = await renewLease({
      token: fixture.nodeToken,
      runtimeId: fixture.runtimeId,
      ticketId: fixture.ticketId,
      runId,
      ttlSeconds: 300,
    });
    expect(renewed.statusCode).toBe(200);
    expect(renewed.body.data.run_id).toBe(runId);

    const missing = await renewLease({
      token: fixture.nodeToken,
      runtimeId: fixture.runtimeId,
      ticketId: fixture.ticketId,
      runId: crypto.randomUUID(),
    });
    expect(missing.statusCode).toBe(409);
    expect(missing.body.error.code).toBe('CONFLICT');

    await pool.query(
      'UPDATE tickets SET assigned_runtime_id = $2 WHERE id = $1',
      [fixture.ticketId, fixture.secondRuntimeId]
    );
    const reassigned = await renewLease({
      token: fixture.nodeToken,
      runtimeId: fixture.runtimeId,
      ticketId: fixture.ticketId,
      runId,
    });
    expect(reassigned.statusCode).toBe(409);
    await pool.query(
      'UPDATE tickets SET assigned_runtime_id = $2 WHERE id = $1',
      [fixture.ticketId, fixture.runtimeId]
    );

    const released = await releaseLease({
      token: fixture.nodeToken,
      runtimeId: fixture.runtimeId,
      ticketId: fixture.ticketId,
      runId,
    });
    expect(released.statusCode).toBe(200);
    expect(released.body.success).toBe(true);

    const missingRelease = await releaseLease({
      token: fixture.nodeToken,
      runtimeId: fixture.runtimeId,
      ticketId: fixture.ticketId,
      runId,
    });
    expect(missingRelease.statusCode).toBe(404);
    expect(missingRelease.body.error.code).toBe('NOT_FOUND');

    const renewAfterRelease = await renewLease({
      token: fixture.nodeToken,
      runtimeId: fixture.runtimeId,
      ticketId: fixture.ticketId,
      runId,
    });
    expect(renewAfterRelease.statusCode).toBe(409);
  });

  test('E8 checkpoint sequence persists context columns', async () => {
    const runId = await createActiveRun();
    const agent = { token: fixture.nodeToken, runtimeId: fixture.runtimeId, runId };
    const workspacePath = '/tmp/bt60-workspace';
    const baseSha = 'bt60-base-sha';
    const sessionId = 'bt60-session';
    const headSha = 'bt60-head-sha';
    const prUrl = 'https://example.test/bt60/pull/8';

    const steps = [
      ['cloned', { workspacePath, baseSha }],
      ['session_ready', { sessionId }],
      ['prompting', { promptVersion: 'v1' }],
      ['verifying', { commands: ['npm test'] }],
      ['publishing', { headSha, prUrl }],
      ['done', { summary: 'ok' }],
    ];

    for (const [step, payload] of steps) {
      const response = await checkpoint({ ...agent, step, payload });
      expect(response.statusCode).toBe(201);
      expect(response.body.data.step).toBe(step);
      expect((await dbRun(runId)).step).toBe(step);
    }

    const run = await dbRun(runId);
    expect(run.workspace_path).toBe(workspacePath);
    expect(run.base_sha).toBe(baseSha);
    expect(run.session_id).toBe(sessionId);
    expect(run.head_sha).toBe(headSha);
    expect(run.pr_url).toBe(prUrl);
    expect(run.step).toBe('done');

    const checkpoints = await request(app)
      .get(`/api/v1/harness/runs/${runId}/checkpoints`)
      .set('X-API-Key', fixture.nodeToken)
      .set('X-Agent-Runtime', String(fixture.runtimeId));
    expect(checkpoints.statusCode).toBe(200);
    expect(checkpoints.body.data.map((entry) => entry.step)).toEqual([
      'cloned',
      'session_ready',
      'prompting',
      'verifying',
      'publishing',
      'done',
    ]);
  });

  test('E9 backward and unknown checkpoints are rejected', async () => {
    const runId = await createActiveRun();
    const agent = { token: fixture.nodeToken, runtimeId: fixture.runtimeId, runId };

    const verifying = await checkpoint({ ...agent, step: 'verifying', payload: {} });
    expect(verifying.statusCode).toBe(201);

    const backward = await checkpoint({ ...agent, step: 'prompting', payload: {} });
    expect(backward.statusCode).toBe(409);
    expect(backward.body.error.code).toBe('CONFLICT');

    const unknown = await checkpoint({ ...agent, step: 'teleporting', payload: {} });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.body.error.code).toBe('VALIDATION_ERROR');

    expect((await dbRun(runId)).step).toBe('verifying');
  });

  test('E10 a checkpoint after finish returns 404', async () => {
    const runId = await createActiveRun();
    const finished = await finishRun({
      token: fixture.nodeToken,
      runtimeId: fixture.runtimeId,
      runId,
      status: 'succeeded',
    });
    expect(finished.statusCode).toBe(200);

    const late = await checkpoint({
      token: fixture.nodeToken,
      runtimeId: fixture.runtimeId,
      runId,
      step: 'done',
      payload: {},
    });
    expect(late.statusCode).toBe(404);
    expect(late.body.error.code).toBe('NOT_FOUND');
  });

  test('E11 heartbeat updates step and rejects a wrong runtime or finished run', async () => {
    const runId = await createActiveRun();
    const before = await dbRun(runId);

    const beat = await heartbeat({
      token: fixture.nodeToken,
      runtimeId: fixture.runtimeId,
      runId,
      step: 'prompting',
    });
    expect(beat.statusCode).toBe(200);
    expect(beat.body.data.agent_step).toBe('prompting');

    const after = await dbRun(runId);
    expect(after.agent_step).toBe('prompting');
    expect(new Date(after.heartbeat_at).getTime())
      .toBeGreaterThanOrEqual(new Date(before.heartbeat_at).getTime());

    const wrongRuntime = await heartbeat({
      token: fixture.nodeToken,
      runtimeId: fixture.secondRuntimeId,
      runId,
      step: 'prompting',
    });
    expect(wrongRuntime.statusCode).toBe(404);

    const finished = await finishRun({
      token: fixture.nodeToken,
      runtimeId: fixture.runtimeId,
      runId,
      status: 'succeeded',
    });
    expect(finished.statusCode).toBe(200);

    const afterFinish = await heartbeat({
      token: fixture.nodeToken,
      runtimeId: fixture.runtimeId,
      runId,
      step: 'verifying',
    });
    expect(afterFinish.statusCode).toBe(404);
  });

  test('E12 finish persists evidence, finalizes artifacts and releases the lease', async () => {
    const runId = await createActiveRun();
    const claimed = await claimLease({
      token: fixture.nodeToken,
      runtimeId: fixture.runtimeId,
      ticketId: fixture.ticketId,
      runId,
    });
    expect(claimed.statusCode).toBe(201);

    const wrongRuntime = await finishRun({
      token: fixture.nodeToken,
      runtimeId: fixture.secondRuntimeId,
      runId,
      status: 'succeeded',
    });
    expect(wrongRuntime.statusCode).toBe(403);
    expect(wrongRuntime.body.error.code).toBe('FORBIDDEN');

    const headSha = 'bt60-finish-head';
    const prUrl = 'https://example.test/bt60/pull/12';
    const finished = await finishRun({
      token: fixture.nodeToken,
      runtimeId: fixture.runtimeId,
      runId,
      status: 'succeeded',
      headSha,
      prUrl,
    });

    expect(finished.statusCode).toBe(200);
    expect(finished.body.data.status).toBe('succeeded');
    expect(finished.body.data.head_sha).toBe(headSha);
    expect(finished.body.data.pr_url).toBe(prUrl);

    const run = await dbRun(runId);
    expect(run.status).toBe('succeeded');
    expect(run.head_sha).toBe(headSha);
    expect(run.pr_url).toBe(prUrl);
    expect(run.finished_at).not.toBeNull();
    // A failed usage flush leaves this NULL and makes the reaper retry forever.
    expect(run.artifacts_finalized_at).not.toBeNull();
    expect(await count(
      'SELECT count(*)::int AS count FROM harness_leases WHERE run_id = $1',
      [runId]
    )).toBe(0);
  });

  test('E13 finish is idempotent and keeps artifacts finalized', async () => {
    const runId = await createActiveRun();
    const first = await finishRun({
      token: fixture.nodeToken,
      runtimeId: fixture.runtimeId,
      runId,
      status: 'succeeded',
      headSha: 'bt60-idempotent-head',
      prUrl: 'https://example.test/bt60/pull/13',
    });
    expect(first.statusCode).toBe(200);
    const firstRun = await dbRun(runId);
    expect(firstRun.artifacts_finalized_at).not.toBeNull();

    const second = await finishRun({
      token: fixture.nodeToken,
      runtimeId: fixture.runtimeId,
      runId,
      status: 'failed',
      headSha: 'bt60-other-head',
      prUrl: 'https://example.test/bt60/pull/other',
      error: 'second finish must not overwrite',
    });

    expect(second.statusCode).toBe(200);
    expect(second.body.data.status).toBe('succeeded');
    expect(second.body.data.head_sha).toBe('bt60-idempotent-head');
    expect(second.body.data.pr_url).toBe('https://example.test/bt60/pull/13');

    const finalRun = await dbRun(runId);
    expect(finalRun.status).toBe('succeeded');
    expect(finalRun.head_sha).toBe(firstRun.head_sha);
    expect(finalRun.finished_at).toEqual(firstRun.finished_at);
    expect(finalRun.artifacts_finalized_at).not.toBeNull();
    expect(finalRun.error).toBeNull();
  });

  test('E14 operator project scope and runtime read/write isolation', async () => {
    const runId = await createActiveRun();

    const owner = await request(app)
      .get(`/api/v1/harness/runs/${runId}`)
      .set('Authorization', `Bearer ${tokenFor(fixture.ownerId, 'project_admin')}`);
    expect(owner.statusCode).toBe(200);
    expect(owner.body.success).toBe(true);

    const member = await request(app)
      .get(`/api/v1/harness/runs/${runId}`)
      .set('Authorization', `Bearer ${tokenFor(fixture.memberId, 'member')}`);
    expect(member.statusCode).toBe(200);

    const memberCheckpoints = await request(app)
      .get(`/api/v1/harness/runs/${runId}/checkpoints`)
      .set('Authorization', `Bearer ${tokenFor(fixture.memberId, 'member')}`);
    expect(memberCheckpoints.statusCode).toBe(200);
    expect(Array.isArray(memberCheckpoints.body.data)).toBe(true);

    const plainUser = await request(app)
      .get(`/api/v1/harness/runs/${runId}`)
      .set('Authorization', `Bearer ${tokenFor(fixture.plainUserId, 'user')}`);
    expect(plainUser.statusCode).toBe(403);

    const outside = await request(app)
      .get(`/api/v1/harness/runs/${runId}`)
      .set('Authorization', `Bearer ${tokenFor(fixture.outsideUserId, 'project_admin')}`);
    expect(outside.statusCode).toBe(403);

    const superAdmin = await request(app)
      .get(`/api/v1/harness/runs/${runId}`)
      .set('Authorization', `Bearer ${tokenFor(fixture.superAdminId, 'super_admin')}`);
    expect(superAdmin.statusCode).toBe(200);

    const ownRuntime = await getRun({
      token: fixture.nodeToken,
      runtimeId: fixture.runtimeId,
      runId,
    });
    expect(ownRuntime.statusCode).toBe(200);

    const otherTenantRuntime = await getRun({
      token: fixture.otherNodeToken,
      runtimeId: fixture.otherRuntimeId,
      runId,
    });
    expect(otherTenantRuntime.statusCode).toBe(403);

    const siblingWrite = await checkpoint({
      token: fixture.nodeToken,
      runtimeId: fixture.secondRuntimeId,
      runId,
      step: 'cloned',
      payload: {},
    });
    expect(siblingWrite.statusCode).toBe(403);
    expect(siblingWrite.body.error.code).toBe('FORBIDDEN');
  });

  test('E23 fixture creation and cleanup remove every test row', async () => {
    const throwaway = await createHarnessFixture();
    expect(throwaway.projectId).not.toBe(fixture.projectId);
    expect(throwaway.nodeId).not.toBe(fixture.nodeId);

    const started = await startRun({
      token: throwaway.nodeToken,
      runtimeId: throwaway.runtimeId,
      ticketId: throwaway.ticketId,
      branch: `${BRANCH_PREFIX}/e23`,
    });
    expect(started.statusCode).toBe(201);
    const runId = started.body.data.id;

    const claimed = await claimLease({
      token: throwaway.nodeToken,
      runtimeId: throwaway.runtimeId,
      ticketId: throwaway.ticketId,
      runId,
    });
    expect(claimed.statusCode).toBe(201);

    const cloned = await checkpoint({
      token: throwaway.nodeToken,
      runtimeId: throwaway.runtimeId,
      runId,
      step: 'cloned',
      payload: { workspacePath: '/tmp/bt60-e23', baseSha: 'e23-base' },
    });
    expect(cloned.statusCode).toBe(201);

    const finished = await finishRun({
      token: throwaway.nodeToken,
      runtimeId: throwaway.runtimeId,
      runId,
      status: 'succeeded',
      headSha: 'e23-head',
      prUrl: 'https://example.test/bt60/pull/23',
    });
    expect(finished.statusCode).toBe(200);

    expect(await count(
      'SELECT count(*)::int AS count FROM harness_checkpoints WHERE run_id = $1',
      [runId]
    )).toBe(1);

    await cleanupHarnessFixture(throwaway);

    const residuals = await residualRows(throwaway);
    expect(Object.entries(residuals).filter(([, value]) => value !== 0)).toEqual([]);
    expect(await count(
      'SELECT count(*)::int AS count FROM harness_checkpoints WHERE run_id = $1',
      [runId]
    )).toBe(0);

    // Idempotent: a failed run/retry can call cleanup again.
    await expect(cleanupHarnessFixture(throwaway)).resolves.toBeUndefined();
  });

  test('E24 fixtures are disposable and uniquely suffixed', async () => {
    expect(fixture.suffix).toMatch(/^\d+_\d+$/);
    expect(fixture.projectId).not.toBe(fixture.otherProjectId);
    expect(fixture.ticketId).not.toBe(fixture.otherTicketId);

    const users = await pool.query(
      'SELECT email FROM users WHERE id = ANY($1::bigint[])',
      [fixture.userIds]
    );
    expect(users.rows).toHaveLength(fixture.userIds.length);
    for (const user of users.rows) {
      expect(user.email).toContain(fixture.suffix);
      expect(user.email.endsWith('@bt60.test')).toBe(true);
    }

    const projects = await pool.query(
      'SELECT name FROM projects WHERE id = ANY($1::bigint[])',
      [fixture.projectIds]
    );
    for (const project of projects.rows) {
      expect(project.name).toContain(fixture.suffix);
    }

    const tickets = await pool.query(
      'SELECT title FROM tickets WHERE id = ANY($1::bigint[])',
      [fixture.ticketIds]
    );
    for (const ticket of tickets.rows) {
      expect(ticket.title).toContain(fixture.suffix);
    }
  });

});
