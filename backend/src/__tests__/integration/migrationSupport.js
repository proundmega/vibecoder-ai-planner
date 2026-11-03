/*
 * Shared migration helpers for the integration test bootstrap.
 *
 * Setup must fail loudly on unexpected migration errors (O8). Only the known
 * idempotent errors below are ignored, because migrations are re-run against a
 * long-lived test database.
 */
const fs = require('fs');
const path = require('path');

const IGNORABLE_MIGRATION_ERRORS = [
  /already exists/i,
  /duplicate key/i,
  /duplicate object/i,
];

function isIgnorableMigrationError(message) {
  return IGNORABLE_MIGRATION_ERRORS.some((pattern) => pattern.test(String(message)));
}

/**
 * Split a SQL script into statements, respecting single quotes, dollar-quoted
 * bodies and comments. Structural only: this does not parse SQL grammar.
 */
function splitSQLStatements(sql) {
  const statements = [];
  let current = '';
  let inSingleQuote = false;
  let inDollarQuote = false;
  let dollarTag = '';
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const remaining = sql.slice(i);

    // Handle line comments: -- until end of line
    if (!inSingleQuote && !inDollarQuote && !inBlockComment && remaining.startsWith('--')) {
      inLineComment = true;
      current += '--';
      i += 1;
      continue;
    }

    // Handle block comments: /* ... */
    if (!inSingleQuote && !inDollarQuote && !inLineComment && remaining.startsWith('/*')) {
      inBlockComment = true;
      current += '/*';
      i += 1;
      continue;
    }

    if (inBlockComment) {
      if (remaining.startsWith('*/')) {
        current += '*/';
        i += 1;
        inBlockComment = false;
      } else {
        current += char;
      }
      continue;
    }

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
        current += char;
      }
      continue;
    }

    if (inDollarQuote) {
      if (remaining.startsWith(dollarTag)) {
        current += dollarTag;
        i += dollarTag.length - 1;
        inDollarQuote = false;
        dollarTag = '';
      } else {
        current += char;
      }
      continue;
    }

    if (remaining.startsWith('$$')) {
      inDollarQuote = true;
      dollarTag = '$$';
      current += '$$';
      i += 1;
      continue;
    }

    const dollarMatch = remaining.match(/^\$[a-zA-Z_]\w*\$/);
    if (dollarMatch) {
      inDollarQuote = true;
      dollarTag = dollarMatch[0];
      current += dollarTag;
      i += dollarTag.length - 1;
      continue;
    }

    if (char === "'" && (i === 0 || sql[i - 1] !== '\\')) {
      inSingleQuote = !inSingleQuote;
    }

    if (char === ';' && !inSingleQuote && !inDollarQuote) {
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      current = '';
      continue;
    }

    current += char;
  }

  const trimmed = current.trim();
  if (trimmed.length > 0) statements.push(trimmed);
  return statements;
}

/**
 * Apply every statement in a SQL script.
 * Throws on the first unexpected error so a broken migration fails the run.
 */
async function applySqlScript(sql, pool, label = 'migration') {
  const statements = splitSQLStatements(sql);
  for (const stmt of statements) {
    try {
      await pool.query(stmt);
    } catch (err) {
      if (isIgnorableMigrationError(err.message)) continue;
      throw new Error(`${label} failed: ${err.message}`);
    }
  }
  return statements.length;
}

async function runMigrationFile(file, pool) {
  const sql = fs.readFileSync(file, 'utf8');
  return applySqlScript(sql, pool, `Migration ${path.basename(file)}`);
}

module.exports = {
  IGNORABLE_MIGRATION_ERRORS,
  isIgnorableMigrationError,
  splitSQLStatements,
  applySqlScript,
  runMigrationFile,
};
