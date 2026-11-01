const fs = require('fs');
const path = require('path');
const { createTicketSchema, updateTicketSchema } = require('../validators/tickets');
const { editTicketSchema } = require('../validators/agents');

const MIGRATIONS_DIR = path.join(__dirname, '../migrations');

describe('priority enum consistency', () => {
  it('accepts "critical" in the create and update validators', () => {
    expect(createTicketSchema.validate({
      projectId: 1,
      title: 'Ticket',
      priority: 'critical',
    }).error).toBeUndefined();

    expect(updateTicketSchema.validate({ priority: 'critical' }).error).toBeUndefined();
    expect(editTicketSchema.validate({ priority: 'critical' }).error).toBeUndefined();
  });

  it('documents "critical" in OpenAPI and frontend contracts', () => {
    const repoRoot = path.join(__dirname, '../../..');
    const files = [
      path.join(__dirname, '../api/openapi-spec.js'),
      path.join(repoRoot, 'frontend/src/api/validator.ts'),
      path.join(repoRoot, 'frontend/src/api/generated/models/Ticket.ts'),
      path.join(repoRoot, 'frontend/src/api/generated/services/TicketsService.ts'),
      path.join(repoRoot, 'frontend/src/api/generated/services/ProjectsService.ts'),
    ];

    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      expect(source).toContain('critical');
    }

    // The checked-in generated spec is the input to `generate:api`; every
    // priority enum there must include critical, not just contain the word.
    const generated = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../api/openapi-generated.json'), 'utf8')
    );
    const priorityEnums = [];
    (function collect(node) {
      if (Array.isArray(node)) {
        if (node.includes('low') && node.includes('urgent')) {
          priorityEnums.push(node);
        }
        node.forEach(collect);
      } else if (node && typeof node === 'object') {
        Object.values(node).forEach(collect);
      }
    })(generated);

    expect(priorityEnums.length).toBeGreaterThanOrEqual(3);
    for (const priorityEnum of priorityEnums) {
      expect(priorityEnum).toContain('critical');
    }
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

    const bootstrap = fs.readFileSync(path.join(MIGRATIONS_DIR, 'migrate.sql'), 'utf8');
    expect(bootstrap).toContain("'critical'");
    expect(bootstrap).toMatch(/CHECK \(priority IN \('low', 'medium', 'high', 'critical', 'urgent'\)\)/);
  });
});
