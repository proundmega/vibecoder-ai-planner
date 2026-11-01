require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const SQL_FILES = [
  path.join(__dirname, './001_create_tables.sql'),
  path.join(__dirname, './002_agents_schema.sql'),
  path.join(__dirname, './003_role_system.sql'),
  path.join(__dirname, './004_persistence_layer.sql'),
  path.join(__dirname, './005_permission_system.sql'),
  path.join(__dirname, './006_ticket_comments.sql'),
  path.join(__dirname, './007_project_repos.sql'),
  path.join(__dirname, './008_ticket_repo_fields.sql'),
  path.join(__dirname, './009_project_providers.sql'),
  path.join(__dirname, './010_project_credentials.sql'),
  path.join(__dirname, './013_usage_logs.sql'),
  path.join(__dirname, './014_project_billing.sql'),
  path.join(__dirname, './011_ticket_ownership.sql'),
  path.join(__dirname, './012_agent_users.sql'),
  path.join(__dirname, './015_shared_agent_memory.sql'),
  path.join(__dirname, './016_ticket_planning.sql'),
  path.join(__dirname, './017_agent_memory_fallback.sql'),
  path.join(__dirname, './018_ticket_phases.sql'),
  path.join(__dirname, './020_provider_configs.sql'),
  path.join(__dirname, './021_agent_heartbeats.sql'),
  path.join(__dirname, './022_review_diffs.sql'),
  path.join(__dirname, './023_environments.sql'),
  path.join(__dirname, './024_deployments.sql'),
  path.join(__dirname, './025_milestones.sql'),
  path.join(__dirname, './026_ticket_milestone_fields.sql'),
  path.join(__dirname, './027_compute_nodes.sql'),
  path.join(__dirname, './028_routing_rules.sql'),
  path.join(__dirname, './029_provider_config_api_key.sql'),
  path.join(__dirname, './030_uuid_to_bigint_fk.sql'),
  path.join(__dirname, './031_expand_credential_types.sql'),
  path.join(__dirname, './031_unify_providers.sql'),
  path.join(__dirname, './032_add_locked_until_to_users.sql'),
  path.join(__dirname, './033_add_api_key_expiry_to_agents.sql'),
  path.join(__dirname, './034_create_ip_whitelist_table.sql'),
  path.join(__dirname, './035_global_providers.sql'),
  path.join(__dirname, './036_fix_usage_logs_fk.sql'),
    path.join(__dirname, './038_planning_usage_columns.sql'),
    path.join(__dirname, './039_create_csp_violations.sql'),
    path.join(__dirname, './040_telemetry_events.sql'),
    path.join(__dirname, './041_add_project_id_to_providers.sql'),
    path.join(__dirname, './042_csp_permissions.sql'),
    path.join(__dirname, './043_make_access_token_nullable.sql'),
    path.join(__dirname, './044_allow_critical_priority.sql'),
];

const DATA_MIGRATIONS = [
  path.join(__dirname, './migrate_provider_api_keys.js'),
  path.join(__dirname, './backfill_agent_key_hashes.js'),
];

const { spawn } = require('child_process');

function classifyStatement(sql) {
  let s = sql.trim();
  // Strip leading block comments
  while (s.startsWith('/*')) {
    const end = s.indexOf('*/');
    if (end === -1) { s = ''; break; }
    s = s.slice(end + 2).trim();
  }
  // Strip leading single-line comments
  while (s.startsWith('--')) {
    const nl = s.indexOf('\n');
    s = nl === -1 ? '' : s.slice(nl + 1).trim();
  }
  const upper = s.toUpperCase();
  if (upper.startsWith('CREATE')) return 'CREATE';
  if (upper.startsWith('ALTER')) return 'ALTER';
  if (upper.startsWith('DROP')) return 'DROP';
  if (upper.startsWith('TRUNCATE')) return 'TRUNCATE';
  if (upper.startsWith('INSERT')) return 'INSERT';
  if (upper.startsWith('UPDATE')) return 'UPDATE';
  if (upper.startsWith('DELETE')) return 'DELETE';
  if (upper.startsWith('COMMENT')) return 'COMMENT';
  if (upper.startsWith('GRANT')) return 'GRANT';
  if (upper.startsWith('REVOKE')) return 'REVOKE';
  return 'OTHER';
}

function splitSQLStatements(sql) {
  const statements = [];
  let current = '';
  let inSingleQuote = false;
  let inDollarQuote = false;
  let dollarTag = '';

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const remaining = sql.slice(i);

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

    // Handle -- comments: skip to end of line so $$ in comments doesn't trigger dollar quotes
    if (remaining.startsWith('--')) {
      const newlineIdx = remaining.indexOf('\n');
      if (newlineIdx === -1) {
        current += remaining;
        i = sql.length - 1;
      } else {
        current += remaining.slice(0, newlineIdx + 1);
        i += newlineIdx;
      }
      continue;
    }

    // Handle /* */ block comments
    if (remaining.startsWith('/*')) {
      const endIdx = remaining.indexOf('*/');
      if (endIdx === -1) {
        current += remaining;
        i = sql.length - 1;
      } else {
        current += remaining.slice(0, endIdx + 2);
        i += endIdx + 1;
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
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = '';
      continue;
    }

    current += char;
  }

  const trimmed = current.trim();
  if (trimmed.length > 0) {
    statements.push(trimmed);
  }

  return statements;
}

function stripComments(sql) {
  let result = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inDollarQuote = false;
  let dollarTag = '';

  for (let i = 0; i < sql.length; i++) {
    const rest = sql.slice(i);

    if (inDollarQuote) {
      if (rest.startsWith(dollarTag)) {
        result += dollarTag;
        i += dollarTag.length - 1;
        inDollarQuote = false;
        dollarTag = '';
      } else {
        result += sql[i];
      }
      continue;
    }

    if (inSingleQuote) {
      result += sql[i];
      if (sql[i] === "'" && sql[i - 1] !== '\\') inSingleQuote = false;
      continue;
    }

    if (inDoubleQuote) {
      result += sql[i];
      if (sql[i] === '"' && sql[i - 1] !== '\\') inDoubleQuote = false;
      continue;
    }

    if (rest.startsWith('--')) {
      const newline = rest.indexOf('\n');
      if (newline === -1) break;
      i += newline;
      result += '\n';
      continue;
    }

    if (rest.startsWith('/*')) {
      const end = rest.indexOf('*/');
      if (end === -1) break;
      i += end + 1;
      continue;
    }

    if (rest.startsWith('$$')) {
      inDollarQuote = true;
      dollarTag = '$$';
      result += '$$';
      i += 1;
      continue;
    }

    const dollarMatch = rest.match(/^\$[a-zA-Z_]\w*\$/);
    if (dollarMatch) {
      inDollarQuote = true;
      dollarTag = dollarMatch[0];
      result += dollarTag;
      i += dollarTag.length - 1;
      continue;
    }

    if (sql[i] === "'") inSingleQuote = true;
    if (sql[i] === '"') inDoubleQuote = true;
    result += sql[i];
  }

  return result;
}

/**
 * Structural validation for dry-run: catches empty statements, unbalanced
 * parentheses and unterminated quotes without connecting to a database.
 * This is not a full SQL grammar parser.
 */
function validateStatementStructure(statement) {
  const cleaned = stripComments(statement).trim();
  if (!cleaned) {
    // Comment-only chunks are harmless; splitSQLStatements may keep them
    // between real statements.
    return null;
  }

  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inDollarQuote = false;
  let dollarTag = '';

  for (let i = 0; i < cleaned.length; i++) {
    const rest = cleaned.slice(i);

    if (inDollarQuote) {
      if (rest.startsWith(dollarTag)) {
        i += dollarTag.length - 1;
        inDollarQuote = false;
        dollarTag = '';
      }
      continue;
    }

    if (inSingleQuote) {
      if (cleaned[i] === "'" && cleaned[i - 1] !== '\\') inSingleQuote = false;
      continue;
    }

    if (inDoubleQuote) {
      if (cleaned[i] === '"' && cleaned[i - 1] !== '\\') inDoubleQuote = false;
      continue;
    }

    if (rest.startsWith('$$')) {
      inDollarQuote = true;
      dollarTag = '$$';
      i += 1;
      continue;
    }

    const dollarMatch = rest.match(/^\$[a-zA-Z_]\w*\$/);
    if (dollarMatch) {
      inDollarQuote = true;
      dollarTag = dollarMatch[0];
      i += dollarTag.length - 1;
      continue;
    }

    if (cleaned[i] === "'") {
      inSingleQuote = true;
    } else if (cleaned[i] === '"') {
      inDoubleQuote = true;
    } else if (cleaned[i] === '(') {
      depth++;
    } else if (cleaned[i] === ')') {
      depth--;
      if (depth < 0) return 'unbalanced parentheses';
    }
  }

  if (inSingleQuote || inDoubleQuote || inDollarQuote) {
    return 'unterminated quoted string';
  }
  if (depth !== 0) {
    return 'unbalanced parentheses';
  }
  return null;
}

async function runMigration(file, dryRun = false, pool = null) {
  // Read and classify before any database connection. Dry-run must work with
  // no DATABASE_URL at all.
  const sql = fs.readFileSync(file, 'utf8');
  const statements = splitSQLStatements(sql);

  console.log(`\n--- ${path.basename(file)} (${statements.length} statements) ---`);

  if (dryRun) {
    const summary = {};
    let valid = true;

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      const trimmed = stmt.trim();

      if (!trimmed) continue;

      const structureError = validateStatementStructure(stmt);
      if (structureError) {
        valid = false;
        console.log(`  [INVALID] ${path.basename(file)} statement ${i + 1}: ${structureError}`);
        continue;
      }

      const type = classifyStatement(stmt);
      summary[type] = (summary[type] || 0) + 1;

      const preview = trimmed.length > 100 ? trimmed.substring(0, 100) + '...' : trimmed;
      console.log(`  [${type}] ${preview}`);
    }

    console.log('\nSummary:');
    for (const [type, count] of Object.entries(summary).sort()) {
      console.log(`  ${type}: ${count}`);
    }
    console.log(`\nTotal: ${Object.values(summary).reduce((a, b) => a + b, 0)} statements would be executed.`);
    return valid;
  }

  if (!pool) {
    throw new Error(`A database pool is required to run ${path.basename(file)}`);
  }

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    try {
      await pool.query(stmt);
      console.log(`  ✓ Statement ${i + 1} executed`);
    } catch (err) {
      console.log(`  ! Statement ${i + 1} (may already exist): ${err.message}`);
    }
  }
  return true;
}

function runDataMigration(file) {
  return new Promise((resolve) => {
    console.log(`\n--- Running data migration: ${path.basename(file)} ---`);
    const child = spawn(process.execPath, [file], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env },
      stdio: 'inherit',
    });
    child.on('close', (code) => {
      if (code !== 0) {
        console.error(`Data migration ${path.basename(file)} exited with code ${code}`);
      }
      resolve();
    });
  });
}

async function migrate(dryRun = false) {
  if (dryRun) {
    let valid = true;
    for (const sqlFile of SQL_FILES) {
      const fileValid = await runMigration(sqlFile, true);
      valid = valid && fileValid;
    }

    for (const dataMigration of DATA_MIGRATIONS) {
      console.log(`\n[DRY-RUN] Would run data migration: ${path.basename(dataMigration)}`);
    }

    console.log('\n\n=== DRY-RUN COMPLETE: no changes were applied ===');
    if (!valid) {
      process.exitCode = 1;
    }
    return;
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    family: 4,
  });

  try {
    // Verify the database once, before running any migration file. A failure
    // here is fatal; do not print one connection error per file and exit 0.
    await pool.query('SELECT NOW()');

    for (const sqlFile of SQL_FILES) {
      await runMigration(sqlFile, false, pool);
    }

    for (const dataMigration of DATA_MIGRATIONS) {
      await runDataMigration(dataMigration);
    }

    console.log('\n\n✓ Migrations completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  if (dryRun) {
    console.log('=== DRY-RUN MODE: No changes will be applied ===\n');
  }

  migrate(dryRun);
}

module.exports = {
  classifyStatement,
  splitSQLStatements,
  validateStatementStructure,
  runMigration,
  migrate,
};
