const { pool } = require('../db');

jest.mock('../db');

describe('PermissionService.init() retry', () => {
  let pm;

  beforeEach(() => {
    jest.clearAllMocks();
    delete require.cache[require.resolve('../services/PermissionService')];
    pm = require('../services/PermissionService');
  });

  it('should retry on DB failure and succeed on second attempt', async () => {
    pool.query
      .mockRejectedValueOnce(new Error('DB connection refused'))
      .mockResolvedValueOnce({ rows: [{ name: 'user' }, { name: 'admin' }] });

    await pm.init(2);

    // 1st roles query fails + 2nd roles query succeeds + resolvePermissions for 'user' + resolvePermissions for 'admin' = 4
    expect(pool.query).toHaveBeenCalledTimes(4);
  });

  it('should throw after exhausting all retries', async () => {
    pool.query.mockRejectedValue(new Error('DB always fails'));

    await expect(pm.init(2)).rejects.toThrow('DB always fails');
    expect(pool.query).toHaveBeenCalledTimes(3);
  });

  it('should succeed on first attempt when DB is available', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ name: 'user' }] });

    await pm.init(3);

    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});
