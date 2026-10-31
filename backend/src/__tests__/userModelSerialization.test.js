const User = require('../models/user');

describe('User model serialization', () => {
  const row = {
    id: 7,
    email: 'alice@example.com',
    name: 'Alice',
    password_hash: '$2a$10$supersecrethash',
    role: 'project_admin',
    current_plan: 'free',
    is_active: true,
    user_created_by: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    locked_until: null,
    login_attempts: 0,
  };

  it('never serializes passwordHash', () => {
    const serialized = JSON.stringify(new User(row));

    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain('$2a$10$supersecrethash');
  });

  it('still exposes the public user fields', () => {
    const json = new User(row).toJSON();

    expect(json).toMatchObject({
      id: 7,
      email: 'alice@example.com',
      name: 'Alice',
      role: 'project_admin',
      isActive: true,
    });
  });

  it('keeps passwordHash available internally for authentication', () => {
    const user = new User(row);
    expect(user.passwordHash).toBe('$2a$10$supersecrethash');
  });
});
