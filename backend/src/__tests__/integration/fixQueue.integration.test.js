const FixRequestService = require('../../services/FixRequestService');
const FixQueueService = require('../../services/FixQueueService');
const { pool: storePool } = require('../../db');

const SHA = 'e'.repeat(40);

async function createFixture() {
  const stamp = `${Date.now()}-${Math.random()}`;
  const user = await global.db.query(
    `INSERT INTO users (email, password_hash, name, role)
     VALUES ($1, 'hash', 'Fix Queue Test', 'project_admin') RETURNING id`,
    [`fix-queue-${stamp}@example.test`]
  );
  const project = await global.db.query(
    `INSERT INTO projects (name, owner_id) VALUES ($1, $2) RETURNING id`,
    [`Fix Queue ${stamp}`, user.rows[0].id]
  );
  const ticket = await global.db.query(
    `INSERT INTO tickets
       (project_id, title, description, status, phase, branch_name, owner_id)
     VALUES ($1, 'Fix queue ticket', 'Fix this', 'review', 'review', $2, $3)
     RETURNING id`,
    [project.rows[0].id, 'feat/fix-queue', user.rows[0].id]
  );
  const attempt = await global.db.query(
    `INSERT INTO ticket_review_attempts
       (ticket_id, reviewed_sha, status, round, verdict, completed_at)
     VALUES ($1, $2, 'completed', 1, 'request_changes', NOW())
     RETURNING *`,
    [ticket.rows[0].id, SHA]
  );
  for (const finding of [
    ['finding-1', 'critical', 'backend/src/App.js', 4, 'Drop scope', 'Add guard'],
    ['finding-2', 'warning', 'backend/src/App.js', 20, 'Missing test', 'Add a case'],
    ['finding-3', 'info', 'backend/src/App.js', null, 'Consider a comment', null],
  ]) {
    await global.db.query(
      `INSERT INTO ticket_review_findings
         (attempt_id, finding_key, severity, file, line, message, suggestion)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [attempt.rows[0].id, ...finding]
    );
  }

  const credential = await global.db.query(
    `INSERT INTO provider_credentials
       (owner_id, project_id, name, provider_type, api_key_encrypted)
     VALUES ($1, $2, $3, 'generic', 'x') RETURNING id`,
    [user.rows[0].id, project.rows[0].id, `fix-cred-${stamp}`]
  );
  const model = await global.db.query(
    `INSERT INTO provider_models (credential_id, model, source, roles)
     VALUES ($1, $2, 'manual', '{worker}') RETURNING id`,
    [credential.rows[0].id, `fix-model-${stamp}`]
  );
  const node = await global.db.query(
    `INSERT INTO agent_nodes (owner_id, name) VALUES ($1, $2) RETURNING id`,
    [user.rows[0].id, `fix-node-${stamp}`]
  );
  const runtimes = [];
  for (const name of ['fix-runtime-1', 'fix-runtime-2']) {
    const runtime = await global.db.query(
      `INSERT INTO agent_runtimes
         (node_id, name, role, model_id, status, current_project_id)
       VALUES ($1, $2, 'worker', $3, 'running', $4) RETURNING id`,
      [node.rows[0].id, `${name}-${stamp}`, model.rows[0].id, project.rows[0].id]
    );
    runtimes.push(runtime.rows[0].id);
  }

  return {
    userId: user.rows[0].id,
    projectId: project.rows[0].id,
    ticketId: ticket.rows[0].id,
    attemptId: attempt.rows[0].id,
    credentialId: credential.rows[0].id,
    modelId: model.rows[0].id,
    nodeId: node.rows[0].id,
    runtimeIds: runtimes,
  };
}

async function cleanup(fixture) {
  const client = await global.db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL harness.allow_event_purge = 'on'");
    await client.query('DELETE FROM harness_events WHERE project_id = $1', [fixture.projectId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await global.db.query('DELETE FROM agent_runtimes WHERE id = ANY($1)', [fixture.runtimeIds]);
  await global.db.query('DELETE FROM agent_nodes WHERE id = $1', [fixture.nodeId]);
  await global.db.query('DELETE FROM provider_models WHERE id = $1', [fixture.modelId]);
  await global.db.query('DELETE FROM provider_credentials WHERE id = $1', [fixture.credentialId]);
  await global.db.query('DELETE FROM tickets WHERE id = $1', [fixture.ticketId]);
  await global.db.query('DELETE FROM projects WHERE id = $1', [fixture.projectId]);
  await global.db.query('DELETE FROM users WHERE id = $1', [fixture.userId]);
}

describe('fg-32b1 fix queue and lease (real DB)', () => {
  afterAll(async () => {
    await storePool.end();
  });

  test('queues a due request with its findings', async () => {
    const fixture = await createFixture();
    try {
      await FixRequestService.createOrEnsure(
        fixture.ticketId, { attemptId: fixture.attemptId });

      const rows = await FixQueueService.listQueue(fixture.projectId);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        ticket_id: fixture.ticketId,
        branch: 'feat/fix-queue',
        reviewed_sha: SHA,
        state: 'queued',
      });
      expect(rows[0].findings.map((finding) => finding.severity))
        .toEqual(['critical', 'warning', 'info']);
      expect(rows[0].findings[0]).toMatchObject({
        severity: 'critical',
        file: 'backend/src/App.js',
        line: 4,
      });
    } finally {
      await cleanup(fixture);
    }
  });

  test('claims atomically, is idempotent for the owner and rejects another runtime', async () => {
    const fixture = await createFixture();
    try {
      await FixRequestService.createOrEnsure(
        fixture.ticketId, { attemptId: fixture.attemptId });
      const [owner, other] = fixture.runtimeIds;

      const first = await FixQueueService.claim(fixture.ticketId, {
        runtimeId: owner, leaseSeconds: 120,
      });
      expect(first).toMatchObject({ claimed: true, reclaimed: false });
      expect(first.request).toMatchObject({
        state: 'claimed',
        claimed_by: owner,
      });

      const repeat = await FixQueueService.claim(fixture.ticketId, {
        runtimeId: owner, leaseSeconds: 120,
      });
      expect(repeat).toMatchObject({ claimed: false, reclaimed: false });

      const renewed = await FixQueueService.renew(fixture.ticketId, {
        runtimeId: owner, leaseSeconds: 240,
      });
      expect(new Date(renewed.lease_expires_at).getTime())
        .toBeGreaterThan(new Date(first.request.lease_expires_at).getTime());

      await expect(FixQueueService.claim(fixture.ticketId, {
        runtimeId: other, leaseSeconds: 120,
      })).rejects.toThrow('claimed by another agent');

      const ticket = await global.db.query(
        'SELECT review_state FROM tickets WHERE id = $1', [fixture.ticketId]);
      expect(ticket.rows[0].review_state).toBe('fixing');
    } finally {
      await cleanup(fixture);
    }
  });

  test('fix runs reference their request with ON DELETE CASCADE', async () => {
    const { rows } = await global.db.query(
      `SELECT confdeltype FROM pg_constraint
        WHERE conname = 'harness_runs_fix_request_id_fkey'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].confdeltype).toBe('c');
  });

  test('cascades a fixer run when its request or attempt is deleted', async () => {
    const fixture = await createFixture();
    try {
      await FixRequestService.createOrEnsure(
        fixture.ticketId, { attemptId: fixture.attemptId });
      const claimed = await FixQueueService.claim(fixture.ticketId, {
        runtimeId: fixture.runtimeIds[0], leaseSeconds: 120,
      });
      const run = await global.db.query(
        `INSERT INTO harness_runs
           (ticket_id, runtime_id, branch, base_sha, purpose, fix_request_id)
         VALUES ($1, $2, 'feat/fix-queue', $3, 'fix', $4) RETURNING id`,
        [fixture.ticketId, fixture.runtimeIds[0], SHA, claimed.request.id]
      );

      // Deleting the attempt cascades request -> run. With ON DELETE SET NULL
      // this failed the purpose/fix_request_id check instead.
      await global.db.query(
        'DELETE FROM ticket_review_attempts WHERE id = $1', [fixture.attemptId]);

      const remainingRun = await global.db.query(
        'SELECT id FROM harness_runs WHERE id = $1', [run.rows[0].id]);
      expect(remainingRun.rows).toHaveLength(0);
      const remainingRequest = await global.db.query(
        'SELECT id FROM ticket_fix_requests WHERE id = $1', [claimed.request.id]);
      expect(remainingRequest.rows).toHaveLength(0);
    } finally {
      await cleanup(fixture);
    }
  });

  test('does not queue or claim a ticket that left in_progress', async () => {
    const fixture = await createFixture();
    try {
      await FixRequestService.createOrEnsure(
        fixture.ticketId, { attemptId: fixture.attemptId });
      await global.db.query(
        "UPDATE tickets SET status = 'review', phase = 'review' WHERE id = $1",
        [fixture.ticketId]
      );

      expect(await FixQueueService.listQueue(fixture.projectId)).toHaveLength(0);
      await expect(FixQueueService.claim(fixture.ticketId, {
        runtimeId: fixture.runtimeIds[0], leaseSeconds: 120,
      })).rejects.toThrow('No active fix request');
    } finally {
      await cleanup(fixture);
    }
  });

  test('does not renew after the ticket leaves in_progress or is deleted', async () => {
    const moved = await createFixture();
    try {
      await FixRequestService.createOrEnsure(
        moved.ticketId, { attemptId: moved.attemptId });
      await FixQueueService.claim(moved.ticketId, {
        runtimeId: moved.runtimeIds[0], leaseSeconds: 120,
      });
      await global.db.query(
        "UPDATE tickets SET status = 'review', phase = 'review' WHERE id = $1",
        [moved.ticketId]
      );

      await expect(FixQueueService.renew(moved.ticketId, {
        runtimeId: moved.runtimeIds[0], leaseSeconds: 120,
      })).rejects.toThrow('No claimed fix request');
    } finally {
      await cleanup(moved);
    }

    const deleted = await createFixture();
    try {
      await FixRequestService.createOrEnsure(
        deleted.ticketId, { attemptId: deleted.attemptId });
      await FixQueueService.claim(deleted.ticketId, {
        runtimeId: deleted.runtimeIds[0], leaseSeconds: 120,
      });
      await global.db.query(
        "UPDATE tickets SET status = 'done', deleted_at = NOW() WHERE id = $1",
        [deleted.ticketId]
      );

      await expect(FixQueueService.renew(deleted.ticketId, {
        runtimeId: deleted.runtimeIds[0], leaseSeconds: 120,
      })).rejects.toThrow('No claimed fix request');
    } finally {
      await cleanup(deleted);
    }
  });

  test('reclaims an expired lease and records an audit event', async () => {
    const fixture = await createFixture();
    try {
      await FixRequestService.createOrEnsure(
        fixture.ticketId, { attemptId: fixture.attemptId });
      const [owner, other] = fixture.runtimeIds;
      await FixQueueService.claim(fixture.ticketId, {
        runtimeId: owner, leaseSeconds: 120,
      });
      await global.db.query(
        `UPDATE ticket_fix_requests
            SET lease_expires_at = NOW() - INTERVAL '1 minute'
          WHERE ticket_id = $1`,
        [fixture.ticketId]
      );

      const reclaimed = await FixQueueService.claim(fixture.ticketId, {
        runtimeId: other, leaseSeconds: 120,
      });

      expect(reclaimed).toMatchObject({ claimed: true, reclaimed: true });
      expect(reclaimed.request.claimed_by).toBe(other);

      const audit = await global.db.query(
        `SELECT runtime_id, agent_id, payload FROM harness_events
          WHERE project_id = $1 AND type = 'fix.lease_reclaimed'`,
        [fixture.projectId]
      );
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0].runtime_id).toBe(other);
      expect(audit.rows[0].agent_id).toBeNull();
      expect(audit.rows[0].payload.previousOwner).toBe(owner);
    } finally {
      await cleanup(fixture);
    }
  });
});
