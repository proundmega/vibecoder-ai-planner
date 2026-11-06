const specs = require('../api/openapi-spec');

const BIGINT_ID_FIELDS = [
  ['User', 'id'],
  ['Project', 'id'],
  ['Project', 'ownerId'],
  ['Ticket', 'id'],
  ['Ticket', 'ownerId'],
  ['Ticket', 'projectId'],
  ['Agent', 'id'],
  ['Agent', 'owner_id'],
];

describe('OpenAPI ticket contract (bp-124)', () => {
  test('dependsOn is documented as string[] because pg returns BIGINT[] as strings', () => {
    const { dependsOn } = specs.components.schemas.Ticket.properties;

    expect(dependsOn.type).toBe('array');
    expect(dependsOn.items.type).toBe('string');
    expect(dependsOn.items.pattern).toBe('^[0-9]+$');
  });

  test.each(BIGINT_ID_FIELDS)('%s.%s references NumericId, not uuid', (schemaName, field) => {
    const schema = specs.components.schemas[schemaName];

    expect(schema.properties[field]).toEqual({ $ref: '#/components/schemas/NumericId' });
  });

  test('NumericId documents a decimal string', () => {
    const { NumericId } = specs.components.schemas;

    expect(NumericId.type).toBe('string');
    expect(NumericId.pattern).toBe('^[0-9]+$');
  });

  test('milestoneId remains a UUID because milestones.id is UUID', () => {
    const { milestoneId } = specs.components.schemas.Ticket.properties;

    expect(milestoneId.type).toBe('string');
    expect(milestoneId.format).toBe('uuid');
  });

  test('assignee fields are documented on the Ticket response', () => {
    const { assigneeId, assigneeName } = specs.components.schemas.Ticket.properties;

    expect(assigneeId).toEqual({ type: 'string', pattern: '^[0-9]+$', nullable: true });
    expect(assigneeName).toEqual({ type: 'string', nullable: true });
  });
});
