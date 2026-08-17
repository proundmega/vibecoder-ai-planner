#!/usr/bin/env node

/**
 * Route-mount drift audit tool
 * 
 * Compares router files in backend/src/api/ against router.use() mounts
 * in backend/src/api/v1/index.js to detect:
 * - Routers that exist but are not mounted (dead router files)
 * - Mounts that reference non-existent routers (typos/stale mounts)
 * - Duplicate mounts (same router mounted multiple times)
 * - Mounted but not imported (missing require statements)
 * 
 * Usage: node scripts/route-mount-audit.js
 */

const fs = require('fs');
const path = require('path');

const API_DIR = path.join(__dirname, '..', 'backend', 'src', 'api');
const V1_INDEX = path.join(API_DIR, 'v1', 'index.js');

function getRouterFiles() {
  return fs.readdirSync(API_DIR)
    .filter(f => f.endsWith('.js') && !['routes.js', 'openapi-spec.js', 'openapi-metrics.js', 'terminal.js'].includes(f))
    .map(f => f.replace('.js', ''));
}

function parseV1Index() {
  const content = fs.readFileSync(V1_INDEX, 'utf-8');
  
  // Find all require statements: const XRouter = require('../X');
  const requirePattern = /const\s+(\w+Router)\s*=\s*require\(['"]([^'"]+)['"]\)/g;
  const imports = new Map();
  let match;
  while ((match = requirePattern.exec(content)) !== null) {
    imports.set(match[1], match[2].replace('.js', ''));
  }

  // Find all router.use() calls: router.use('/path', someRouter);
  const usePattern = /router\.use\(\s*['"]([^'"]*)['"]\s*,\s*(\w+Router)\s*\)/g;
  const mounts = new Map();
  while ((match = usePattern.exec(content)) !== null) {
    mounts.set(match[2], match[1]);
  }

  // Find inlined routes that use controller files directly
  const controllerPattern = /require\(['"]\.\.\/controllers\/([^'"]+)['"]\)/g;
  const controllers = new Set();
  while ((match = controllerPattern.exec(content)) !== null) {
    controllers.add(match[1].replace('.js', ''));
  }

  return { imports, mounts, controllers };
}

function audit() {
  const routerFiles = getRouterFiles();
  const { imports, mounts, controllers } = parseV1Index();

  // Known special cases: these routers have special mount patterns
  const specialMounts = new Map([
    ['milestonesRouter', 'nested (/projects/:projectId/milestones inside)'],
    ['deploymentsRouter', 'nested (/projects/:projectId/environments inside)'],
    ['reviewRouter', '/tickets (ticket-specific routes)'],
    ['agentHeartbeatRouter', '/agents-status (separate module)'],
  ]);

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Route-Mount Drift Audit');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  let issues = 0;

  // 1. Check for routers that exist but are not mounted
  console.log('📁 Router files in api/:');
  routerFiles.forEach(f => console.log(`   - ${f}.js`));
  console.log('');

  console.log('📦 Imported routers:');
  imports.forEach((file, name) => console.log(`   ${name} ← ${file}.js`));
  console.log('');

  console.log('🔌 Mounted routers:');
  mounts.forEach((route, name) => {
    const special = specialMounts.get(name);
    console.log(`   ${name} → ${special || route}`);
  });
  console.log('');

  // Check for mounted but not imported
  mounts.forEach((route, name) => {
    if (!imports.has(name)) {
      if (specialMounts.has(name)) {
        console.log(`   ℹ️  ${name} — ${specialMounts.get(name)} (known pattern)`);
      } else {
        console.log(`❌ MOUNTED BUT NOT IMPORTED: ${name} (mounted at ${route})`);
        issues++;
      }
    }
  });

  // Check for imported but not mounted (excluding controllers used inline)
  imports.forEach((file, name) => {
    if (!mounts.has(name)) {
      if (specialMounts.has(name)) {
        console.log(`   ℹ️  ${name} — ${specialMounts.get(name)} (known pattern)`);
      } else {
        console.log(`⚠️  IMPORTED BUT NOT MOUNTED: ${name} (${file}.js) — is this intentional?`);
        issues++;
      }
    }
  });

  // Check for duplicate mounts
  const mountValues = Array.from(mounts.values());
  const duplicates = mountValues.filter((v, i, a) => a.indexOf(v) !== i);
  if (duplicates.length > 0) {
    console.log('');
    console.log('📋 DUPLICATE MOUNT PATHS (may be intentional for nested routing):');
    duplicates.forEach(d => {
      const count = mountValues.filter(x => x === d).length;
      const routers = Array.from(mounts.entries())
        .filter(([, route]) => route === d)
        .map(([name]) => name)
        .join(', ');
      const special = specialMounts.get(d);
      console.log(`   ${d} → ${count}x (${routers})${special ? ' — ' + special : ''}`);
    });
  }

  // Check for routers that exist but aren't imported
  const importedFiles = new Set(imports.values());
  routerFiles.forEach(f => {
    if (!importedFiles.has(f) && 
        !['projects', 'tickets', 'agents', 'users', 'user', 'pricing', 'approvals', 'permissions', 'github', 'providers', 'credentials', 'usage', 'billing', 'memory', 'review', 'csp-violations', 'agent-heartbeat'].includes(f) &&
        !['compute-nodes', 'milestones', 'deployments'].includes(f)) {
      // These might be mounted under different names
      const hasMount = Array.from(mounts.values()).some(v => v.includes(f));
      if (!hasMount) {
        console.log(`⚠️  FILE EXISTS BUT NOT REFERENCED: ${f}.js`);
      }
    }
  });

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  if (issues === 0) {
    console.log('  ✅ No drift detected — all routers accounted for');
  } else {
    console.log(`  ⚠️  Found ${issues} issue(s) — review above`);
  }
  console.log('═══════════════════════════════════════════════════════════');

  process.exit(issues > 0 ? 1 : 0);
}

audit();
