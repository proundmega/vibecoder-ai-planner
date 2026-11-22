const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const HarnessRunService = require('../../services/HarnessRunService');
const TicketQuestionService = require('../../services/TicketQuestionService');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const FORWARD_SQL = path.join(
  __dirname, '../../migrations/060_ticket_questions_notifications.sql');
const ROLLBACK_SQL = path.join(
  __dirname, '../../migrations/060_ticket_questions_notifications_rollback.sql');
const suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

describe('Migration 060 questions and notifications (real DB, transactional)', () => {
  let client;
  let schema;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set for integration tests');
    }
    client = await pool.connect();
    schema = `fg55_questions_test_${suffix}`;
  });

  afterAll(async () => {
    if (client) client.release();
    await pool.end();
  });

  test('applies the additive tables/columns and rolls back', async () => {
    await client.query('BEGIN');
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET LOCAL search_path TO ${schema}, public`);
      await client.query('CREATE TABLE users (id BIGINT PRIMARY KEY)');
      await client.query('CREATE TABLE projects (id BIGINT PRIMARY KEY)');
      await client.query('CREATE TABLE tickets (id BIGINT PRIMARY KEY)');
      await client.query('CREATE TABLE agent_runtimes (id BIGINT PRIMARY KEY)');
      await client.query('CREATE TABLE harness_runs (id UUID PRIMARY KEY)');

      await client.query('INSERT INTO users (id) VALUES (1)');
      await client.query('INSERT INTO projects (id) VALUES (5)');
      await client.query('INSERT INTO tickets (id) VALUES (42)');
      await client.query('INSERT INTO agent_runtimes (id) VALUES (3)');
      await client.query(
        "INSERT INTO harness_runs (id) VALUES ('11111111-1111-4111-8111-111111111111')"
      );

      await client.query(fs.readFileSync(FORWARD_SQL, 'utf8'));

      const columns = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = 'harness_runs'
           AND column_name IN ('waiting_since', 'waited_ms')`,
        [schema]
      );
      expect(columns.rows.map((row) => row.column_name).sort())
        .toEqual(['waited_ms', 'waiting_since']);

      const question = await client.query(
        `INSERT INTO ticket_questions
           (run_id, ticket_id, project_id, runtime_id, external_id, kind, prompt)
         VALUES ('11111111-1111-4111-8111-111111111111', 42, 5, 3, 'evt_1',
                 'question', 'Which helper?')
         RETURNING id`
      );
      await client.query(
        `INSERT INTO notifications
           (user_id, project_id, ticket_id, run_id, question_id, type, payload)
         VALUES (1, 5, 42, '11111111-1111-4111-8111-111111111111', $1,
                 'question', '{"preview":"Which helper?"}'::jsonb)`,
        [question.rows[0].id]
      );

      const stored = await client.query(
        `SELECT type, read_at FROM notifications WHERE user_id = 1`
      );
      expect(stored.rows[0]).toMatchObject({ type: 'question', read_at: null });

      await client.query('SAVEPOINT bad_kind');
      await expect(client.query(
        `INSERT INTO ticket_questions
           (run_id, ticket_id, project_id, runtime_id, kind, prompt)
         VALUES ('11111111-1111-4111-8111-111111111111', 42, 5, 3, 'bogus', 'x')`
      )).rejects.toThrow(/check constraint/);
      await client.query('ROLLBACK TO SAVEPOINT bad_kind');

      await client.query(fs.readFileSync(ROLLBACK_SQL, 'utf8'));

      const after = await client.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = $1 AND table_name IN ('ticket_questions', 'notifications')`,
        [schema]
      );
      expect(after.rows).toHaveLength(0);
      const afterColumns = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = 'harness_runs'
           AND column_name IN ('waiting_since', 'waited_ms')`,
        [schema]
      );
      expect(afterColumns.rows).toHaveLength(0);
    } finally {
      await client.query('ROLLBACK');
    }
  });

  test('finishRun expires the pending question and notifies project recipients', async () => {
    const tag = `fg55_finish_${Date.now()}`;
    const owner = await client.query(
      `INSERT INTO users (email, name, password_hash)
       VALUES ($1, 'FG55 owner', 'x') RETURNING id`,
      [`${tag}@test.local`]
    );
    const member = await client.query(
      `INSERT INTO users (email, name, password_hash)
       VALUES ($1, 'FG55 member', 'x') RETURNING id`,
      [`${tag}-member@test.local`]
    );
    const project = await client.query(
      `INSERT INTO projects (name, owner_id) VALUES ($1, $2) RETURNING id`,
      [tag, owner.rows[0].id]
    );
    await client.query(
      `INSERT INTO project_memberships (project_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [project.rows[0].id, member.rows[0].id]
    );
    const credential = await client.query(
      `INSERT INTO provider_credentials
         (owner_id, name, provider_type, api_key_encrypted)
       VALUES ($1, $2, 'openai', 'x') RETURNING id`,
      [owner.rows[0].id, `${tag}-cred`]
    );
    const model = await client.query(
      `INSERT INTO provider_models (credential_id, model, source, roles)
       VALUES ($1, $2, 'manual', ARRAY['worker']) RETURNING id`,
      [credential.rows[0].id, `${tag}-model`]
    );
    const node = await client.query(
      `INSERT INTO agent_nodes (owner_id, name) VALUES ($1, $2) RETURNING id`,
      [owner.rows[0].id, `${tag}-node`]
    );
    const runtime = await client.query(
      `INSERT INTO agent_runtimes
         (node_id, name, role, model_id, status, current_project_id)
       VALUES ($1, $2, 'worker', $3, 'running', $4) RETURNING id`,
      [node.rows[0].id, `${tag}-worker`, model.rows[0].id, project.rows[0].id]
    );
    const ticket = await client.query(
      `INSERT INTO tickets (project_id, title, owner_id, status, assigned_runtime_id, locked_at)
       VALUES ($1, $2, $3, 'in_progress', $4, NOW()) RETURNING id`,
      [project.rows[0].id, `${tag} ticket`, owner.rows[0].id, runtime.rows[0].id]
    );
    const run = await client.query(
      `INSERT INTO harness_runs
         (ticket_id, runtime_id, project_id, branch, status, waiting_since)
       VALUES ($1, $2, $3, $4, 'running', NOW()) RETURNING id`,
      [ticket.rows[0].id, runtime.rows[0].id, project.rows[0].id, `feat/${tag}`]
    );
    const question = await client.query(
      `INSERT INTO ticket_questions
         (run_id, ticket_id, project_id, runtime_id, external_id, kind, prompt)
       VALUES ($1, $2, $3, $4, 'evt_finish', 'question', 'Which helper?')
       RETURNING id`,
      [run.rows[0].id, ticket.rows[0].id, project.rows[0].id, runtime.rows[0].id]
    );

    try {
      const finished = await HarnessRunService.finishRun(run.rows[0].id, {
        status: 'succeeded',
        prUrl: 'https://example.test/pr/1',
      });
      expect(finished.status).toBe('succeeded');
      expect(finished.waiting_since).toBeNull();

      const storedQuestion = await client.query(
        'SELECT status FROM ticket_questions WHERE id = $1',
        [question.rows[0].id]
      );
      expect(storedQuestion.rows[0].status).toBe('expired');

      const notifications = await client.query(
        `SELECT user_id, type FROM notifications WHERE project_id = $1
         ORDER BY user_id`,
        [project.rows[0].id]
      );
      expect(notifications.rows).toHaveLength(2);
      expect(new Set(notifications.rows.map((row) => String(row.user_id))))
        .toEqual(new Set([String(owner.rows[0].id), String(member.rows[0].id)]));
      expect(notifications.rows.every((row) => row.type === 'run_succeeded')).toBe(true);
    } finally {
      await client.query('DELETE FROM agent_runtimes WHERE node_id = $1', [node.rows[0].id]);
      await client.query('DELETE FROM provider_models WHERE credential_id = $1',
        [credential.rows[0].id]);
      await client.query('DELETE FROM provider_credentials WHERE id = $1',
        [credential.rows[0].id]);
      await client.query('DELETE FROM projects WHERE id = $1', [project.rows[0].id]);
      await client.query('DELETE FROM agent_nodes WHERE id = $1', [node.rows[0].id]);
      await client.query('DELETE FROM users WHERE id = ANY($1::bigint[])',
        [[owner.rows[0].id, member.rows[0].id]]);
    }
  });

  test('createForRun persists, dedupes and answer clears waiting', async () => {
    const tag = `fg55_create_${Date.now()}`;
    const owner = await client.query(
      `INSERT INTO users (email, name, password_hash)
       VALUES ($1, 'FG55 create owner', 'x') RETURNING id`,
      [`${tag}@test.local`]
    );
    const project = await client.query(
      `INSERT INTO projects (name, owner_id) VALUES ($1, $2) RETURNING id`,
      [tag, owner.rows[0].id]
    );
    const credential = await client.query(
      `INSERT INTO provider_credentials
         (owner_id, name, provider_type, api_key_encrypted)
       VALUES ($1, $2, 'openai', 'x') RETURNING id`,
      [owner.rows[0].id, `${tag}-cred`]
    );
    const model = await client.query(
      `INSERT INTO provider_models (credential_id, model, source, roles)
       VALUES ($1, $2, 'manual', ARRAY['worker']) RETURNING id`,
      [credential.rows[0].id, `${tag}-model`]
    );
    const node = await client.query(
      `INSERT INTO agent_nodes (owner_id, name) VALUES ($1, $2) RETURNING id`,
      [owner.rows[0].id, `${tag}-node`]
    );
    const runtime = await client.query(
      `INSERT INTO agent_runtimes
         (node_id, name, role, model_id, status, current_project_id)
       VALUES ($1, $2, 'worker', $3, 'running', $4) RETURNING id`,
      [node.rows[0].id, `${tag}-worker`, model.rows[0].id, project.rows[0].id]
    );
    const ticket = await client.query(
      `INSERT INTO tickets (project_id, title, owner_id, status, assigned_runtime_id, locked_at)
       VALUES ($1, $2, $3, 'in_progress', $4, NOW()) RETURNING id`,
      [project.rows[0].id, `${tag} ticket`, owner.rows[0].id, runtime.rows[0].id]
    );
    const run = await client.query(
      `INSERT INTO harness_runs (ticket_id, runtime_id, project_id, branch)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [ticket.rows[0].id, runtime.rows[0].id, project.rows[0].id, `feat/${tag}`]
    );

    try {
      const question = await TicketQuestionService.createForRun({
        runId: run.rows[0].id,
        runtimeId: runtime.rows[0].id,
        externalId: 'evt_create',
        kind: 'question',
        prompt: 'Which helper?',
      });
      expect(question.status).toBe('pending');

      const duplicate = await TicketQuestionService.createForRun({
        runId: run.rows[0].id,
        runtimeId: runtime.rows[0].id,
        externalId: 'evt_create',
        kind: 'question',
        prompt: 'Which helper?',
      });
      expect(duplicate.id).toBe(question.id);

      const waiting = await client.query(
        'SELECT waiting_since FROM harness_runs WHERE id = $1',
        [run.rows[0].id]
      );
      expect(waiting.rows[0].waiting_since).not.toBeNull();

      const notification = await client.query(
        'SELECT user_id, type FROM notifications WHERE question_id = $1',
        [question.id]
      );
      expect(notification.rows).toEqual([
        { user_id: owner.rows[0].id, type: 'question' },
      ]);

      const answered = await TicketQuestionService.answer(
        run.rows[0].id,
        question.id,
        { answer: 'Use the helper.', userId: owner.rows[0].id }
      );
      expect(answered.status).toBe('answered');

      const cleared = await client.query(
        'SELECT waiting_since, waited_ms FROM harness_runs WHERE id = $1',
        [run.rows[0].id]
      );
      expect(cleared.rows[0].waiting_since).toBeNull();
      expect(Number(cleared.rows[0].waited_ms)).toBeGreaterThanOrEqual(0);
    } finally {
      await client.query('DELETE FROM agent_runtimes WHERE node_id = $1', [node.rows[0].id]);
      await client.query('DELETE FROM provider_models WHERE credential_id = $1',
        [credential.rows[0].id]);
      await client.query('DELETE FROM provider_credentials WHERE id = $1',
        [credential.rows[0].id]);
      await client.query('DELETE FROM projects WHERE id = $1', [project.rows[0].id]);
      await client.query('DELETE FROM agent_nodes WHERE id = $1', [node.rows[0].id]);
      await client.query('DELETE FROM users WHERE id = $1', [owner.rows[0].id]);
    }
  });
});
