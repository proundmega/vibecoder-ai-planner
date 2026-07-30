const { classifyStatement, splitSQLStatements } = require('../migrations/apply');

describe('classifyStatement', () => {
  it('classifies CREATE statements', () => {
    expect(classifyStatement('CREATE TABLE users (id SERIAL)')).toBe('CREATE');
  });

  it('classifies CREATE TABLE IF NOT EXISTS', () => {
    expect(classifyStatement('CREATE TABLE IF NOT EXISTS users (id SERIAL)')).toBe('CREATE');
  });

  it('classifies CREATE INDEX', () => {
    expect(classifyStatement('CREATE INDEX idx_users_email ON users(email)')).toBe('CREATE');
  });

  it('classifies ALTER statements', () => {
    expect(classifyStatement('ALTER TABLE users ADD COLUMN email VARCHAR(255)')).toBe('ALTER');
  });

  it('classifies ALTER TABLE ADD CONSTRAINT', () => {
    expect(classifyStatement('ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email)')).toBe('ALTER');
  });

  it('classifies DROP statements', () => {
    expect(classifyStatement('DROP TABLE users')).toBe('DROP');
  });

  it('classifies DROP INDEX', () => {
    expect(classifyStatement('DROP INDEX IF EXISTS idx_users_email')).toBe('DROP');
  });

  it('classifies TRUNCATE statements', () => {
    expect(classifyStatement('TRUNCATE TABLE users')).toBe('TRUNCATE');
  });

  it('classifies INSERT statements', () => {
    expect(classifyStatement("INSERT INTO users (name) VALUES ('test')")).toBe('INSERT');
  });

  it('classifies UPDATE statements', () => {
    expect(classifyStatement("UPDATE users SET name = 'test'")).toBe('UPDATE');
  });

  it('classifies DELETE statements', () => {
    expect(classifyStatement('DELETE FROM users WHERE id = 1')).toBe('DELETE');
  });

  it('classifies COMMENT statements', () => {
    expect(classifyStatement("COMMENT ON COLUMN users.email IS 'Email'")).toBe('COMMENT');
  });

  it('classifies GRANT statements', () => {
    expect(classifyStatement('GRANT SELECT ON users TO admin')).toBe('GRANT');
  });

  it('classifies REVOKE statements', () => {
    expect(classifyStatement('REVOKE ALL ON users FROM admin')).toBe('REVOKE');
  });

  it('classifies unknown statements as OTHER', () => {
    expect(classifyStatement('BEGIN')).toBe('OTHER');
    expect(classifyStatement('COMMIT')).toBe('OTHER');
    expect(classifyStatement('ROLLBACK')).toBe('OTHER');
    expect(classifyStatement('SET')).toBe('OTHER');
    expect(classifyStatement('SELECT')).toBe('OTHER');
  });

  it('is case-insensitive', () => {
    expect(classifyStatement('create table users (id SERIAL)')).toBe('CREATE');
    expect(classifyStatement('Create Table Users (Id Serial)')).toBe('CREATE');
    expect(classifyStatement('alter table users add column email varchar(255)')).toBe('ALTER');
    expect(classifyStatement('drop table users')).toBe('DROP');
  });

  it('handles SQL with leading whitespace', () => {
    expect(classifyStatement('  CREATE TABLE users (id SERIAL)')).toBe('CREATE');
    expect(classifyStatement('   ALTER TABLE users ADD COLUMN email VARCHAR(255)')).toBe('ALTER');
  });

  it('handles SQL with leading newlines', () => {
    expect(classifyStatement('\nCREATE TABLE users (id SERIAL)')).toBe('CREATE');
  });

  it('strips leading single-line comments', () => {
    expect(classifyStatement('-- comment\nCREATE TABLE users (id SERIAL)')).toBe('CREATE');
    expect(classifyStatement('-- comment 1\n-- comment 2\nALTER TABLE users ADD COLUMN email VARCHAR(255)')).toBe('ALTER');
  });

  it('strips leading block comments', () => {
    expect(classifyStatement('/* comment */CREATE TABLE users (id SERIAL)')).toBe('CREATE');
    expect(classifyStatement('/*\nmulti-line\ncomment\n*/DROP TABLE users')).toBe('DROP');
  });

  it('handles mixed comments and whitespace', () => {
    expect(classifyStatement('  -- comment\n  CREATE TABLE users (id SERIAL)')).toBe('CREATE');
    expect(classifyStatement('/* header */\n-- note\nALTER TABLE x ADD COLUMN y INT')).toBe('ALTER');
  });
});

describe('splitSQLStatements with dry-run classification', () => {
  it('splits a migration with multiple statement types', () => {
    const sql = `
      CREATE TABLE csp_violations (
        id SERIAL PRIMARY KEY,
        violated_directive VARCHAR(255)
      );
      CREATE INDEX idx_csp_violations_created_at ON csp_violations(created_at DESC);
      COMMENT ON TABLE csp_violations IS 'Stores CSP violation reports';
    `;
    const statements = splitSQLStatements(sql);
    expect(statements).toHaveLength(3);
    expect(classifyStatement(statements[0])).toBe('CREATE');
    expect(classifyStatement(statements[1])).toBe('CREATE');
    expect(classifyStatement(statements[2])).toBe('COMMENT');
  });

  it('handles CREATE INDEX CONCURRENTLY', () => {
    const sql = 'CREATE INDEX CONCURRENTLY idx_name ON table_name(column_name);';
    const statements = splitSQLStatements(sql);
    expect(statements).toHaveLength(1);
    expect(classifyStatement(statements[0])).toBe('CREATE');
  });
});
