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

function walkSchemas(node, visit, key) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((item) => walkSchemas(item, visit));
    return;
  }
  if (key) visit(key, node);
  for (const [childKey, child] of Object.entries(node)) {
    walkSchemas(child, visit, childKey);
  }
}

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

describe('OpenAPI path/body id contract (bp-133 FR2)', () => {
  const numericId = { $ref: '#/components/schemas/NumericId' };

  test('only milestoneId is documented as a UUID in paths and request bodies', () => {
    const uuidFields = [];
    walkSchemas(specs.paths, (key, value) => {
      if (value && value.format === 'uuid') uuidFields.push(key);
    });

    expect(uuidFields).toEqual(['milestoneId']);
  });

  test.each([
    ['/tickets/{ticketId}', 'get', 'ticketId'],
    ['/projects/{id}', 'get', 'id'],
    ['/users/{id}', 'put', 'id'],
    ['/agents/{agentId}', 'put', 'agentId'],
    ['/approvals/{approvalId}/approve', 'post', 'approvalId'],
  ])('%s %s documents %s as NumericId', (pathName, method, paramName) => {
    const operation = specs.paths[pathName][method];
    const param = operation.parameters.find((p) => p.name === paramName);

    expect(param.schema).toEqual(numericId);
  });

  test('BIGSERIAL request-body ids are NumericId (ticket create/update)', () => {
    const create = specs.paths['/tickets'].post.requestBody.content['application/json'].schema;
    const update = specs.paths['/tickets/{ticketId}'].put.requestBody.content['application/json'].schema;

    expect(create.properties.projectId).toEqual(numericId);
    expect(update.properties.assigneeId).toEqual({
      type: 'string',
      pattern: '^[0-9]+$',
      nullable: true,
    });
  });
});
