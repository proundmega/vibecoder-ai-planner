const fs = require('fs');
const os = require('os');
const path = require('path');
const { runMigration } = require('../migrations/apply');

describe('migration runner failure handling (NFR8)', () => {
  it('rolls back and rethrows when a statement fails', async () => {
    const file = path.join(os.tmpdir(), `fg54-mig-${Date.now()}.sql`);
    fs.writeFileSync(file, 'CREATE TABLE ok (id int);\nBROKEN SQL HERE;\n');

    const client = {
      query: jest.fn((sql) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') {
          return Promise.resolve();
        }
        if (sql.includes('BROKEN')) return Promise.reject(new Error('syntax error'));
        return Promise.resolve();
      }),
      release: jest.fn(),
    };
    const pool = { connect: jest.fn().mockResolvedValue(client) };

    await expect(runMigration(file, false, pool)).rejects.toThrow('syntax error');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
    fs.unlinkSync(file);
  });
});
