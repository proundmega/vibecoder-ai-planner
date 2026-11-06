const specs = require('../api/openapi-spec');
const User = require('../models/user');

describe('OpenAPI User contract (bp-133 FR1)', () => {
  test('schema fields match the serialized User model', () => {
    const user = new User({
      id: '1',
      email: 'user@example.test',
      name: 'User',
      role: 'member',
      current_plan: 'free',
      is_active: true,
      user_created_by: '2',
      created_at: new Date(),
      locked_until: null,
      login_attempts: 0,
    });

    expect(Object.keys(specs.components.schemas.User.properties).sort())
      .toEqual(Object.keys(user.toJSON()).sort());
  });

  test('uses the camelCase contract and drops stale snake_case timestamps', () => {
    const props = specs.components.schemas.User.properties;

    expect(props.createdAt).toEqual({ type: 'string', format: 'date-time' });
    expect(props.created_at).toBeUndefined();
    expect(props.updated_at).toBeUndefined();
    expect(props.userCreatedBy).toEqual({
      type: 'string',
      pattern: '^[0-9]+$',
      nullable: true,
    });
    expect(props.lockedUntil).toEqual({
      type: 'string',
      format: 'date-time',
      nullable: true,
    });
    expect(props.loginAttempts).toEqual({ type: 'integer' });
  });
});
