const { Pool } = require('pg');
const HarnessPrivacyService = require('../../services/HarnessPrivacyService');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

describe('Harness privacy export (real DB)', () => {
  let ownerId;
  let projectId;
  let ticketId;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set for integration tests');
    }
    const owner = await pool.query(
      `INSERT INTO users (email, name, password_hash, role)
       VALUES ($1, 'Export Owner', 'x', 'project_admin') RETURNING id`,
      [`export_owner_${suffix}@test.com`]
    );
    ownerId = owner.rows[0].id;
    const project = await pool.query(
      'INSERT INTO projects (name, owner_id) VALUES ($1, $2) RETURNING id',
      [`Export Project ${suffix}`, ownerId]
    );
    projectId = project.rows[0].id;
    const ticket = await pool.query(
      `INSERT INTO tickets (project_id, title, status, owner_id)
       VALUES ($1, 'Export ticket', 'backlog', $2) RETURNING id`,
      [projectId, ownerId]
    );
    ticketId = ticket.rows[0].id;
    for (const content of [
      'first contact alice@example.com token ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'second contact bob@example.com',
    ]) {
      await pool.query(
        `INSERT INTO ticket_messages (ticket_id, user_id, message_type, content)
         VALUES ($1, $2, 'update', $3)`,
        [ticketId, ownerId, content]
      );
    }
  });

  afterAll(async () => {
    if (projectId) {
      await pool.query('DELETE FROM ticket_messages WHERE ticket_id = $1', [ticketId]);
      await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
    }
    if (ownerId) {
      await pool.query('DELETE FROM users WHERE id = $1', [ownerId]);
    }
    await pool.end();
  });

  test('redacts PII and credentials in exported rows', async () => {
    const data = await HarnessPrivacyService.exportProjectData(projectId, {
      limit: 10,
      offset: 0,
    });

    const combined = JSON.stringify(data.messages);
    expect(combined).not.toContain('alice@example.com');
    expect(combined).not.toContain('bob@example.com');
    expect(combined).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(combined).toContain('[REDACTED_EMAIL]');
    expect(combined).toContain('[REDACTED]');
    expect(data.hasMore).toBe(false);
    expect(data.nextOffset).toBeNull();
  });

  test('paginates exported rows with nextOffset', async () => {
    const first = await HarnessPrivacyService.exportProjectData(projectId, {
      limit: 1,
      offset: 0,
    });
    expect(first.messages).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    expect(first.nextOffset).toBe(1);

    const second = await HarnessPrivacyService.exportProjectData(projectId, {
      limit: 1,
      offset: first.nextOffset,
    });
    expect(second.messages).toHaveLength(1);
    expect(second.messages[0].id).not.toBe(first.messages[0].id);
  });
});
