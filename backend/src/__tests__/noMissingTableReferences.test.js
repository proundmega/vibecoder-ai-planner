/*
 * bp-124 O2: `project_agents` and `audit_log` were referenced by dead methods
 * but never existed in any migration. Guard against reintroducing SQL against
 * tables that have no schema.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['__tests__', 'migrations', 'node_modules']);

function collectSources(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectSources(path.join(dir, entry.name), files);
    } else if (entry.name.endsWith('.js')) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

describe('no references to tables without migrations (bp-124 O2)', () => {
  const sources = collectSources(SRC);

  it.each(['project_agents', 'audit_log'])('no production SQL references %s', (table) => {
    const offenders = sources.filter((file) => {
      const contents = fs.readFileSync(file, 'utf8');
      return new RegExp(`\\b${table}\\b`).test(contents);
    });

    expect(offenders).toEqual([]);
  });
});
