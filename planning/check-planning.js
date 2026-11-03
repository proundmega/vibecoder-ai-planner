#!/usr/bin/env node
/*
 * Checks that planning suites follow the single-source rules in README.md.
 * Legacy suites (no YAML frontmatter in 00) are skipped so the historical
 * backlog does not fail the check.
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SKIP = new Set(['DONE', 'archived']);
const failures = [];
const checked = [];

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

for (const name of fs.readdirSync(ROOT)) {
  const dir = path.join(ROOT, name);
  if (SKIP.has(name) || !fs.statSync(dir).isDirectory()) continue;
  const checklist = path.join(dir, '00_ARCHITECT_CHECKLIST.md');
  if (!fs.existsSync(checklist)) continue;

  const zero = read(checklist);
  if (!zero.startsWith('---\n')) continue; // legacy suite
  checked.push(name);

  const fail = (msg) => failures.push(`${name}: ${msg}`);

  if (!/^id:\s*"?[a-z]{2}-\d+"?\s*$/m.test(zero)) fail('00 frontmatter is missing a valid id');
  if (!/^status:\s*(planned|in_progress|in_review|done|deferred|cancelled)$/m.test(zero)) {
    fail('00 frontmatter is missing a valid status');
  }
  if (!/^## Deferred register \(canonical\)/m.test(zero)) {
    fail('00 is missing the canonical Deferred register');
  }
  if ((zero.match(/^## Deferred register \(canonical\)/gm) || []).length > 1) {
    fail('00 has more than one Deferred register');
  }

  const docs = fs.readdirSync(dir).filter((f) => /^\d\d_.*\.md$/.test(f));
  for (const file of docs) {
    if (file === '00_ARCHITECT_CHECKLIST.md') continue;
    const text = read(path.join(dir, file));
    if (/^## Pending Scope Items/m.test(text)) {
      fail(`${file} still has a legacy Pending Scope section; link to 00 instead`);
    }
    if (/^\*\*Status:?\*\*/m.test(text)) {
      fail(`${file} carries a Status line; status lives in 00 frontmatter`);
    }
  }

  const requirement = path.join(dir, '01_ARCHITECT_REQUIREMENT.md');
  if (fs.existsSync(requirement)) {
    const text = read(requirement);
    const ids = new Set();
    for (const m of text.matchAll(/^\|\s*((?:FR|NFR)\d+)\s*\|/gm)) ids.add(m[1]);
    for (const m of text.matchAll(/^\s*-\s*\*\*((?:FR|NFR)\d+)\b/gm)) ids.add(m[1]);
    if (!ids.size) fail('01 has no numbered FR*/NFR* requirements');
  }
}

if (failures.length) {
  console.error(`Planning check failed (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`Planning check passed for ${checked.length} migrated suite(s).`);
