const {
  isIgnorableMigrationError,
  splitSQLStatements,
  applySqlScript,
} = require('./integration/migrationSupport');

describe('integration migration support (bp-124 O8)', () => {
  describe('splitSQLStatements', () => {
    it('splits on statement boundaries', () => {
      expect(splitSQLStatements('CREATE TABLE a (id INT); CREATE TABLE b (id INT);'))
        .toHaveLength(2);
    });

    it('keeps semicolons inside strings and dollar-quoted bodies', () => {
      const sql = `INSERT INTO t VALUES ('a;b');
CREATE FUNCTION f() RETURNS void AS $$ BEGIN PERFORM 1; END; $$ LANGUAGE plpgsql;`;
      const statements = splitSQLStatements(sql);
      expect(statements).toHaveLength(2);
      expect(statements[0]).toContain("'a;b'");
      expect(statements[1]).toContain('PERFORM 1;');
    });

    it('ignores trailing whitespace', () => {
      expect(splitSQLStatements('   \n\t ')).toHaveLength(0);
    });
  });

  describe('isIgnorableMigrationError', () => {
    it.each([
      'relation "tickets" already exists',
      'duplicate key value violates unique constraint',
      'duplicate object',
    ])('ignores idempotent error: %s', (message) => {
      expect(isIgnorableMigrationError(message)).toBe(true);
    });

    it('does not ignore syntax or missing-column errors', () => {
      expect(isIgnorableMigrationError('syntax error at or near "SELCT"')).toBe(false);
      expect(isIgnorableMigrationError('column "foo" does not exist')).toBe(false);
    });
  });

  describe('applySqlScript', () => {
    it('runs every statement against the pool', async () => {
      const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };

      const count = await applySqlScript('SELECT 1; SELECT 2;', pool);

      expect(count).toBe(2);
      expect(pool.query).toHaveBeenCalledTimes(2);
    });

    it('skips idempotent "already exists" errors', async () => {
      const pool = {
        query: jest.fn()
          .mockRejectedValueOnce(new Error('relation "x" already exists'))
          .mockResolvedValueOnce({ rows: [] }),
      };

      await expect(applySqlScript('CREATE TABLE x (); SELECT 1;', pool)).resolves.toBe(2);
    });

    it('fails the run on an unexpected migration error', async () => {
      const pool = { query: jest.fn().mockRejectedValue(new Error('syntax error at or near "SELCT"')) };

      await expect(applySqlScript('SELCT 1;', pool, 'Migration 999_test.sql'))
        .rejects
        .toThrow('Migration 999_test.sql failed: syntax error at or near "SELCT"');
    });
  });
});
