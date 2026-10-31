jest.mock('../db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../services/ProjectService', () => ({ getOne: jest.fn() }));

const { pool } = require('../db');
const ProjectService = require('../services/ProjectService');
const { getProjectUsers } = require('../controllers/projectController');

describe('getProjectUsers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ProjectService.getOne.mockResolvedValue({ id: 1, ownerId: 2 });
  });

  it('returns only project members and the project owner', async () => {
    const rows = [
      { id: 2, name: 'Owner', email: 'owner@example.com', role: 'project_admin' },
      { id: 3, name: 'Member', email: 'member@example.com', role: 'member' },
    ];
    pool.query.mockResolvedValue({ rows });

    const req = { params: { id: 1 }, user: { userId: 99 } };
    const res = { json: jest.fn() };
    const next = jest.fn();

    await getProjectUsers(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('project_memberships');
    expect(sql).toContain('owner_id');
    expect(sql).toContain('u.id != $1');
    expect(params).toEqual([99, 1]);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: rows });
  });

  it('propagates query errors', async () => {
    const error = new Error('db down');
    pool.query.mockRejectedValue(error);

    const req = { params: { id: 1 }, user: { userId: 99 } };
    const res = { json: jest.fn() };
    const next = jest.fn();

    await getProjectUsers(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(res.json).not.toHaveBeenCalled();
  });
});
