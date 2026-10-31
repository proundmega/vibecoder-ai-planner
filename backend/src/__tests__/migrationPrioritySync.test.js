const fs = require('fs');
const path = require('path');
const { createTicketSchema, updateTicketSchema } = require('../validators/tickets');

const MIGRATIONS_DIR = path.join(__dirname, '../migrations');

describe('priority enum consistency', () => {
  it('accepts "critical" in the create and update validators', () => {
    expect(createTicketSchema.validate({
      projectId: 1,
      title: 'Ticket',
      priority: 'critical',
    }).error).toBeUndefined();

    expect(updateTicketSchema.validate({ priority: 'critical' }).error).toBeUndefined();
  });

  it('registers the migration that adds "critical" to the DB constraint', () => {
    const applySource = fs.readFileSync(path.join(MIGRATIONS_DIR, 'apply.js'), 'utf8');
    expect(applySource).toContain('044_allow_critical_priority.sql');
  });

  it('has a migration and a rollback that agree on the allowed priorities', () => {
    const forward = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '044_allow_critical_priority.sql'),
      'utf8'
    );
    const rollback = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '044_allow_critical_priority_rollback.sql'),
      'utf8'
    );

    expect(forward).toContain("'critical'");
    expect(rollback).toMatch(/CHECK \(priority IN \('low', 'medium', 'high', 'urgent'\)\)/);
    expect(rollback).toContain('valid_priorities');
  });
});
