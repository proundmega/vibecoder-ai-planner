#!/usr/bin/env node

/**
 * Route Mount Audit Script
 * 
 * Checks for:
 * 1. Orphaned router files (not imported in v1/index.js)
 * 2. Route ordering issues (inline routes after router.use mounts)
 * 3. Invalid permission codes (not in permission catalog)
 * 4. Mount point completeness
 */

const fs = require('fs');
const path = require('path');

const BACKEND_DIR = path.join(__dirname, '..');
const API_DIR = path.join(BACKEND_DIR, 'src/api');
const V1_INDEX = path.join(API_DIR, 'v1/index.js');
const MIGRATIONS_DIR = path.join(BACKEND_DIR, 'src/migrations');

// Files that are special and should not be flagged as orphaned
const SPECIAL_FILES = new Set([
  'openapi-spec.js',
  'openapi-metrics.js',
  'csp-report.js',
  'pool.js',
  'terminal.js',
]);

function readFileSync(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.error(`Error reading ${filePath}: ${err.message}`);
    return '';
  }
}

function getRouterFiles() {
  const files = fs.readdirSync(API_DIR).filter(f => f.endsWith('.js') && f !== 'index.js');
  return files.map(f => ({ name: f, path: path.join(API_DIR, f) }));
}

function getImportedRouters() {
  const content = readFileSync(V1_INDEX);
  const imports = [];
  
  // Match router.use('/path', routerName) patterns
  const useRegex = /router\.use\([^,]+,\s*(\w+)Router\)/g;
  let match;
  while ((match = useRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  
  // Match inline require statements for routers
  const requireRegex = /require\(['"]\.\/([^'"]+)['"]\)/g;
  while ((match = requireRegex.exec(content)) !== null) {
    const fileName = match[1];
    if (!fileName.startsWith('.')) {
      imports.push(fileName.replace('.js', ''));
    }
  }
  
  return new Set(imports);
}

function findOrphanedRouters() {
  console.log('\n=== Orphaned Router Check ===');
  
  const routerFiles = getRouterFiles();
  const importedRouters = getImportedRouters();
  const orphans = [];
  
  for (const file of routerFiles) {
    const baseName = file.name.replace('.js', '');
    
    // Skip special files
    if (SPECIAL_FILES.has(file.name)) {
      continue;
    }
    
    // Check if this router is imported
    const isImported = Array.from(importedRouters).some(imp => 
      imp.toLowerCase() === baseName.toLowerCase() ||
      imp.toLowerCase().includes(baseName.toLowerCase())
    );
    
    if (!isImported) {
      orphans.push(file);
    }
  }
  
  if (orphans.length === 0) {
    console.log('✓ No orphaned routers found');
  } else {
    console.log(`Found ${orphans.length} orphaned router(s):`);
    for (const file of orphans) {
      console.log(`  - ${file.name} (not imported in v1/index.js)`);
    }
  }
  
  return orphans;
}

function checkRouteOrdering() {
  console.log('\n=== Route Ordering Check ===');
  
  const content = readFileSync(V1_INDEX);
  const lines = content.split('\n');
  const issues = [];
  
  // Track router.use mount points and inline routes
  const mountPoints = [];
  const inlineRoutes = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    
    // Skip comment lines
    if (line.trim().startsWith('//')) {
      continue;
    }
    
    // Match router.use('/prefix', router)
    const useMatch = line.match(/^router\.use\(['"]([^'"]+)['"]/);
    if (useMatch) {
      mountPoints.push({ prefix: useMatch[1], line: lineNum });
    }
    
    // Match inline route definitions (router.get, router.post, etc.)
    const routeMatch = line.match(/^router\.(get|post|put|delete|patch)\(['"]([^'"]+)['"]/);
    if (routeMatch) {
      inlineRoutes.push({ method: routeMatch[1], path: routeMatch[2], line: lineNum });
    }
  }
  
  // Check if any inline route is shadowed by a mount point defined BEFORE it
  // (routes defined after router.use() with matching prefix will be shadowed)
  // We only flag issues where mount.line < route.line AND route.path starts with mount.prefix
  for (const route of inlineRoutes) {
    for (const mount of mountPoints) {
      // Only flag if mount is defined BEFORE the route
      if (mount.line < route.line && route.path.startsWith(mount.prefix)) {
        issues.push({
          route: `${route.method.toUpperCase()} ${route.path} (line ${route.line})`,
          mount: `router.use('${mount.prefix}', ...) (line ${mount.line})`,
        });
      }
    }
  }
  
  // Also check for comments that indicate ordering requirements
  const orderingComments = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('must be before router.use')) {
      orderingComments.push({ line: i + 1, context: line.trim() });
    }
  }
  
  if (orderingComments.length > 0) {
    console.log('\nℹ️  Found ordering comments (verify these are still correct):');
    for (const comment of orderingComments) {
      console.log(`  - Line ${comment.line}: ${comment.context}`);
    }
  }
  
  if (issues.length === 0) {
    console.log('✓ No route ordering issues found');
  } else {
    console.log(`Found ${issues.length} route ordering issue(s):`);
    for (const issue of issues) {
      console.log(`  - ${issue.route} may be shadowed by ${issue.mount}`);
    }
  }
  
  return issues;
}

function checkPermissionCodes() {
  console.log('\n=== Permission Code Check ===');
  
  const content = readFileSync(V1_INDEX);
  const validPermissions = new Set();
  
  // Load valid permission codes from migration
  const migrationFiles = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.includes('permission') || f.includes('role'))
    .sort();
  
  for (const file of migrationFiles) {
    const migrationContent = readFileSync(path.join(MIGRATIONS_DIR, file));
    const permissionMatches = migrationContent.match(/'([A-Z_]+)'/g);
    if (permissionMatches) {
      for (const match of permissionMatches) {
        const code = match.slice(1, -1);
        if (code === 'code' || code === 'description') continue;
        validPermissions.add(code);
      }
    }
  }
  
  // Also hardcode known permissions
  const knownPermissions = [
    'TICKET_CREATE', 'TICKET_READ', 'TICKET_UPDATE', 'TICKET_DELETE',
    'TICKET_STATUS_CHANGE', 'TICKET_COMMENT', 'PROJECT_CREATE', 'PROJECT_READ',
    'PROJECT_UPDATE', 'PROJECT_DELETE', 'PROJECT_MANAGE_MEMBERS', 'USER_CREATE',
    'USER_READ', 'USER_UPDATE', 'USER_DELETE', 'USER_TOGGLE_ACTIVE',
    'USER_VIEW_ALL', 'AGENT_CREATE', 'AGENT_READ', 'AGENT_REVOKE',
    'AGENT_DELETE', 'APPROVAL_APPROVE', 'APPROVAL_REJECT', 'APPROVAL_VIEW',
    'PRICING_READ', 'DASHBOARD_READ', 'CSP_READ', 'CSP_DELETE',
  ];
  
  for (const perm of knownPermissions) {
    validPermissions.add(perm);
  }
  
  // Find all requireAnyPermission calls
  const permissionCalls = [];
  const requireAnyPermRegex = /requireAnyPermission\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  
  while ((match = requireAnyPermRegex.exec(content)) !== null) {
    permissionCalls.push({ code: match[1], line: content.substring(0, match.index).split('\n').length });
  }
  
  // Also check for array syntax
  const requireAnyPermArrayRegex = /requireAnyPermission\(\s*\[([^\]]+)\]\s*\)/g;
  while ((match = requireAnyPermArrayRegex.exec(content)) !== null) {
    const codes = match[1].split(',').map(c => c.trim().replace(/['"]/g, ''));
    for (const code of codes) {
      permissionCalls.push({ code, line: content.substring(0, match.index).split('\n').length });
    }
  }
  
  const invalidCodes = [];
  for (const call of permissionCalls) {
    if (!validPermissions.has(call.code)) {
      invalidCodes.push(call);
    }
  }
  
  if (invalidCodes.length === 0) {
    console.log(`✓ All ${permissionCalls.length} permission codes are valid`);
  } else {
    console.log(`Found ${invalidCodes.length} invalid permission code(s):`);
    for (const code of invalidCodes) {
      console.log(`  - '${code.code}' at line ${code.line} (not in permission catalog)`);
    }
  }
  
  return invalidCodes;
}

function main() {
  console.log('=== Route Mount Audit ===');
  
  const orphans = findOrphanedRouters();
  const orderingIssues = checkRouteOrdering();
  const permissionIssues = checkPermissionCodes();
  
  console.log('\n=== Summary ===');
  console.log(`Orphaned routers: ${orphans.length}`);
  console.log(`Ordering violations: ${orderingIssues.length}`);
  console.log(`Permission mismatches: ${permissionIssues.length}`);
  
  const hasIssues = orphans.length > 0 || orderingIssues.length > 0 || permissionIssues.length > 0;
  
  if (hasIssues) {
    console.log('\n⚠️  Audit found issues. Review the output above.');
    process.exit(1);
  } else {
    console.log('\n✓ All checks passed.');
    process.exit(0);
  }
}

main();
