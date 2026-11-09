const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const planningRoot = __dirname;

test('FR5 repository self-check exits 0', () => {
  const result = spawnSync(
    process.execPath,
    [path.join(planningRoot, 'check-planning.js')],
    { cwd: planningRoot, encoding: 'utf8' }
  );

  assert.equal(
    result.status,
    0,
    `checker failed:\n${result.stdout}\n${result.stderr}`
  );
  assert.match(result.stdout, /Planning check passed/);
});
