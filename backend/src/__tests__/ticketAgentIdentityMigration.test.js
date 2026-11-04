const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '../migrations');

describe('048 ticket assigned agent migration', () => {
  const forwardPath = path.join(MIGRATIONS_DIR, '048_ticket_assigned_agent_fk.sql');
  const rollbackPath = path.join(MIGRATIONS_DIR, '048_ticket_assigned_agent_fk_rollback.sql');

  test('is registered in apply.js after 047', () => {
    const applySource = fs.readFileSync(path.join(MIGRATIONS_DIR, 'apply.js'), 'utf8');

    expect(applySource).toContain('048_ticket_assigned_agent_fk.sql');
    expect(applySource.indexOf('048_ticket_assigned_agent_fk.sql'))
      .toBeGreaterThan(applySource.indexOf('047_harness_checkpoint_publish_evidence.sql'));
  });

  test('has a rollback counterpart', () => {
    expect(fs.existsSync(forwardPath)).toBe(true);
    expect(fs.existsSync(rollbackPath)).toBe(true);
  });

  test('forward migration points the FK at agents(id) and backfills via owner_id', () => {
    const sql = fs.readFileSync(forwardPath, 'utf8');

    expect(sql).toContain('REFERENCES agents(id)');
    expect(sql).toContain('a.owner_id = t.assigned_agent_id');
    expect(sql).toContain('tickets_assigned_agent_id_agent_fkey');
    expect(sql).toContain('current_schema()');
  });

  test('forward migration releases unmapped in_progress tickets', () => {
    const sql = fs.readFileSync(forwardPath, 'utf8');

    expect(sql).toContain("CASE WHEN t.status = 'in_progress' THEN 'backlog'");
    expect(sql).toContain('CREATE TRIGGER release_agent_tickets_on_delete');
    expect(sql).toContain('BEFORE DELETE ON agents');
  });

  test('rollback restores the users(id) FK and releases unmapped tickets', () => {
    const sql = fs.readFileSync(rollbackPath, 'utf8');

    expect(sql).toContain('REFERENCES users(id)');
    expect(sql).toContain('a.owner_id');
    expect(sql).toContain('tickets_assigned_agent_id_fkey');
    expect(sql).toContain("CASE WHEN t.status = 'in_progress' THEN 'backlog'");
    expect(sql).toContain('DROP TRIGGER IF EXISTS release_agent_tickets_on_delete');
  });
});
