jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
  },
}));

jest.mock('../services/PermissionService', () => ({
  hasPermission: jest.fn(),
}));

const { pool } = require('../db');
const PermissionService = require('../services/PermissionService');
const service = require('../services/UserService');

function lastSql() {
  return pool.query.mock.calls[pool.query.mock.calls.length - 1][0];
}

describe('UserService list queries exclude soft-deleted users (bp-133 FR3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
    PermissionService.hasPermission.mockResolvedValue(false);
  });

  it('listUsers filters soft-deleted rows', async () => {
    await service.listUsers('1', 'project_admin');

    expect(lastSql()).toContain('deleted_at IS NULL');
  });

  it('listAllUsers filters soft-deleted rows', async () => {
    await service.listAllUsers();

    expect(lastSql()).toContain('deleted_at IS NULL');
  });

  it('returns live users and omits deleted ones in both lists', async () => {
    const rows = [
      { id: '1', email: 'live@example.test', deleted_at: null },
      { id: '2', email: 'deleted@example.test', deleted_at: new Date() },
    ];

    // Simulate the database predicate the guard is protecting.
    pool.query.mockImplementation(async (sql) => {
      const filtersDeleted = sql.includes('deleted_at IS NULL');
      return { rows: filtersDeleted ? rows.filter((row) => row.deleted_at === null) : rows };
    });

    const projectAdminList = await service.listUsers('9', 'project_admin');
    expect(projectAdminList.map((user) => user.email)).toEqual(['live@example.test']);

    PermissionService.hasPermission.mockResolvedValue(true);
    const superAdminList = await service.listAllUsers();
    expect(superAdminList.map((user) => user.email)).toEqual(['live@example.test']);
  });
});
