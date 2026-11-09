#!/usr/bin/env node
/*
 * Checks that planning suites follow the single-source and review rules in
 * README.md. Legacy suites (no YAML frontmatter in 00) are skipped so the
 * historical backlog does not fail.
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SKIP = new Set(['DONE', 'archived', 'lightweight']);
const failures = [];
const checked = [];

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function frontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const values = {};
  for (const line of match[1].split('\n')) {
    const entry = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!entry) continue;
    values[entry[1]] = entry[2]
      .replace(/\s+#.*$/, '')
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return values;
}

function collectRequirements(text) {
  const ids = new Set();
  for (const m of text.matchAll(/^\|\s*((?:FR|NFR)\d+)\s*\|/gm)) ids.add(m[1]);
  for (const m of text.matchAll(/^\s*-\s*\*\*((?:FR|NFR)\d+)\b/gm)) ids.add(m[1]);
  for (const m of text.matchAll(/^#{2,4}\s*((?:FR|NFR)\d+)\b/gm)) ids.add(m[1]);
  for (const m of text.matchAll(/^\s*\*\*((?:FR|NFR)\d+)\b/gm)) ids.add(m[1]);
  return [...ids];
}

function section(text, heading) {
  const match = text.match(heading);
  if (!match) return null;
  const start = match.index + match[0].length;
  const rest = text.slice(start);
  const next = rest.search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next);
}

function indexRow(file, id) {
  if (!fs.existsSync(file)) return '';
  const text = read(file);
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^\\|\\s*(?:\\*\\*|~~)?\\s*${escaped}\\s*(?:\\*\\*|~~)?\\s*\\|`, 'm');
  const match = text.match(re);
  if (!match) return '';
  const start = text.lastIndexOf('\n', match.index) + 1;
  const end = text.indexOf('\n', match.index);
  return text.slice(start, end === -1 ? undefined : end);
}

for (const name of fs.readdirSync(ROOT)) {
  const dir = path.join(ROOT, name);
  if (SKIP.has(name) || !fs.statSync(dir).isDirectory()) continue;
  const checklist = path.join(dir, '00_ARCHITECT_CHECKLIST.md');
  if (!fs.existsSync(checklist)) continue;

  const zero = read(checklist);
  const fm = frontmatter(zero);
  if (!fm) continue; // legacy suite
  checked.push(name);

  const fail = (msg) => failures.push(`${name}: ${msg}`);
  const status = fm.status;
  const pr = fm.pr;
  const implementationPath = path.join(dir, '03_ARCHITECT_IMPLEMENTATION.md');
  const requirementPath = path.join(dir, '01_ARCHITECT_REQUIREMENT.md');
  const implementation = fs.existsSync(implementationPath)
    ? read(implementationPath)
    : '';
  const requirement = fs.existsSync(requirementPath)
    ? read(requirementPath)
    : '';

  if (!/^[a-z]{2}-\d+$/.test(fm.id || '')) fail('00 frontmatter is missing a valid id');
  if (!/^(planned|in_progress|in_review|done|deferred|cancelled)$/.test(status || '')) {
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
    if (/^\s*(?:[-*]\s*)?\*\*Status:?\*\*/m.test(text)) {
      fail(`${file} carries a Status line; status lives in 00 frontmatter`);
    }
  }

  if (!implementation) {
    fail('03_ARCHITECT_IMPLEMENTATION.md is missing');
  } else {
    const requirements = requirement ? collectRequirements(requirement) : [];
    const matrix = section(implementation, /^#{2,3} Verification matrix[^\n]*\n/m);
    if (matrix !== null) {
      const matrixIds = new Set(
        [...matrix.matchAll(/^\|\s*((?:FR|NFR)\d+)\s*\|/gm)].map((m) => m[1])
      );
      for (const id of requirements) {
        if (!matrixIds.has(id)) fail(`03 verification matrix is missing ${id}`);
      }
    } else if (['planned', 'in_progress', 'in_review'].includes(status)) {
      fail('03 is missing the canonical Verification matrix');
    }

    if (status === 'done') {
      if (!pr || pr === 'null') fail('status is done but pr is not set');
      if (!/^## Status evidence/m.test(zero)) {
        fail('done suite is missing the Status evidence table');
      }
      const results = section(implementation, /^## Results\s*\n/m);
      if (results === null) {
        fail('status is done but 03 has no ## Results section');
      } else {
        const dated = results
          .split('\n')
          .filter((line) => /^\|\s*\d{4}-\d\d-\d\d\s*\|/.test(line));
        if (!dated.length) fail('status is done but 03 Results has no dated row');
        if (dated.some((line) => /Not run|—\s*\|\s*—\s*\|\s*—/.test(line))) {
          fail('status is done but 03 Results is a placeholder');
        }
      }
      if (/To be filled in when implementation starts/i.test(implementation)) {
        fail('done suite has a "to be filled in" placeholder in 03');
      }
      if (/^\|\s*\|\s*\|\s*\|\s*\|\s*$/m.test(implementation)) {
        fail('done suite has an empty table row in 03');
      }
    }

    if (['planned', 'deferred'].includes(status)) {
      if (pr && pr !== 'null') fail(`status is ${status} but pr is set`);
      for (const [file, text] of [['00', zero], ['03', implementation]]) {
        const prose = text
          .split('\n')
          .filter((line) => !/^\s*\|/.test(line))
          .join('\n');
        if (/\bImplementation (?:is |was |has )?merged\b/i.test(prose)) {
          fail(`${file} claims the implementation is merged while status is ${status}`);
        }
      }
    }

    if (status === 'in_review' && (!pr || pr === 'null')) {
      fail('status is in_review but pr is not set');
    }
  }

  if (requirement) {
    const ids = collectRequirements(requirement);
    if (!ids.length) fail('01 has no numbered FR*/NFR* requirements');
  }

  if (fm.id) {
    for (const file of [
      path.join(ROOT, '..', 'PENDING.txt'),
      path.join(ROOT, 'HARNESS_ROADMAP.md'),
    ]) {
      const label = path.basename(file);
      const row = indexRow(file, fm.id);
      if (!row) continue;
      if (['planned', 'deferred'].includes(status)) {
        if (/\bMerged \(#\d+\)/.test(row) && !/\bPlan merged\b/i.test(row)) {
          fail(`${label} marks ${fm.id} as Merged but 00 is ${status}`);
        }
      }
      if (status === 'done') {
        if (/\bPlan merged\b/i.test(row)) {
          fail(`${label} marks ${fm.id} as Plan merged but 00 is done`);
        }
        if (/\bPlanned\b/i.test(row) && !/\bMerged\b/i.test(row)) {
          fail(`${label} marks ${fm.id} as Planned but 00 is done`);
        }
      }
    }
  }
}

if (failures.length) {
  console.error(`Planning check failed (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`Planning check passed for ${checked.length} migrated suite(s).`);
