# 04_SPECIFICATION.md — Multi-Provider Configs Execution Spec

**Use this file when a small model (7B–34B) will execute the ticket.**

**Generated from**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`
**Target model**: 34B local model
**Date**: 2025-07-24

---

## Test-First Requirement

**Test stub files MUST be created before any production code.**

The model MUST:
1. Create **empty test stub files** (with imports, `describe` blocks, and stub `it` blocks) for every test file listed in "Test Expectations" below
2. Create **production code files** (implementation + components)
3. Fill in the test stubs with actual assertions

---

## File Operations

### CREATE: `backend/src/migrations/XXX_add_project_id_to_providers.sql`

```sql
ALTER TABLE providers ADD COLUMN project_id UUID REFERENCES projects(id);
CREATE INDEX idx_providers_project_id ON providers(project_id);
```

### CREATE: `backend/src/migrations/XXX_add_project_id_to_providers_rollback.sql`

```sql
DROP INDEX IF EXISTS idx_providers_project_id;
ALTER TABLE providers DROP COLUMN IF EXISTS project_id;
```

### MODIFY: `backend/src/services/ProviderService.js`

**Replace** `getGlobalProvider()` method with `getProjectProviders(projectId)`:

Before:
```javascript
async getGlobalProvider() {
  const result = await pool.query(
    `SELECT * FROM providers
     WHERE is_project_director = true AND is_active = true
     LIMIT 1`
  );
  return result.rows[0] || null;
}
```

After:
```javascript
async getProjectProviders(projectId) {
  const result = await pool.query(
    `SELECT * FROM providers
     WHERE (project_id = $1 OR project_id IS NULL) AND is_active = true
     ORDER BY project_id IS NULL ASC`,
    [projectId]
  );
  return result.rows;
}
```

**Update** `resolveProvider(ticketInfo)` to accept `projectId` parameter:

Before:
```javascript
async resolveProvider(ticketInfo) {
  const config = await this.getGlobalProvider();
  // ...
}
```

After:
```javascript
async resolveProvider(ticketInfo, projectId = null) {
  const providers = await this.getProjectProviders(projectId);
  
  if (providers.length === 0) {
    throw new Error('No active provider configuration found');
  }
  
  // Separate project-scoped and global providers
  const projectProviders = providers.filter(p => p.project_id === projectId);
  const globalProviders = providers.filter(p => p.project_id === null);
  
  // Try project-scoped providers first
  for (const provider of projectProviders) {
    const config = await this._tryResolve(provider, ticketInfo);
    if (config) return config;
  }
  
  // Fall back to global providers
  for (const provider of globalProviders) {
    const config = await this._tryResolve(provider, ticketInfo);
    if (config) return config;
  }
  
  throw new Error('No matching provider configuration found');
}
```

**Add** helper method `_tryResolve()`:
```javascript
async _tryResolve(provider, ticketInfo) {
  const rules = provider.routing_rules;
  if (!rules || !Array.isArray(rules.rules) || rules.rules.length === 0) {
    return this._defaultProvider(provider);
  }
  
  const ticketLabels = new Set(ticketInfo.labels || []);
  const ticketPriority = ticketInfo.priority || 'medium';
  
  for (const rule of rules.rules) {
    if (this._matches(rule.match, ticketLabels, ticketPriority)) {
      return this._buildProviderConfig(provider, rule, false);
    }
  }
  
  if (rules.fallback) {
    return this._buildProviderConfig(provider, rules.fallback, true);
  }
  
  return null; // No match
}
```

### MODIFY: `backend/src/api/providers.js`

**Update** `GET /providers` handler:

Before:
```javascript
router.get('/', verifyToken, providerController.listProviders);
```

After:
```javascript
router.get('/', verifyToken, async (req, res, next) => {
  try {
    const { project_id } = req.query;
    const providers = await providerController.listProviders(project_id || null);
    res.json({ providers });
  } catch (err) {
    next(err);
  }
});
```

### MODIFY: `backend/src/__tests__/providerService.test.js`

**Add test cases**:

```javascript
describe('ProviderService - Multi-Provider', () => {
  it('resolveProvider() checks project-scoped providers first', async () => {
    // Create project-scoped provider, global provider
    // Call resolveProvider(ticketInfo, projectId)
    // Verify project-scoped provider is used
  });

  it('resolveProvider() falls back to global provider', async () => {
    // Create only global provider
    // Call resolveProvider(ticketInfo, projectId)
    // Verify global provider is used
  });

  it('getProjectProviders() returns correct providers for project', async () => {
    // Create providers for project A, project B, and global
    // Call getProjectProviders(projectA.id)
    // Verify only project A + global are returned
  });
});
```

---

## Test Expectations

### Backend Unit Tests — Multi-Provider
```
✓ [happy] resolveProvider() checks project-scoped providers first
✓ [happy] resolveProvider() falls back to global provider when no project match
✓ [happy] getProjectProviders() returns correct providers for project
✓ [happy] Global provider still works when no project-scoped providers exist
✓ [shape] Providers ordered: project-scoped first, global last
✓ [edge] Empty providers list throws 'No active provider configuration found'
```

---

## Edge Cases to Handle

1. **[Backward compatibility]**: Existing providers have `project_id = NULL`. They remain global and continue to work.
2. **[Multiple global providers]**: `ORDER BY project_id IS NULL ASC` ensures project-scoped providers are checked first.
3. **[Project deleted]**: Orphaned providers remain with `project_id = X`. Consider cascade delete in future.
4. **[Routing rules conflict]**: First match wins (ordered by creation date, project-scoped first).

---

## Existing Code Patterns to Follow

- Backend uses CommonJS (`require`, `module.exports`)
- Migrations: `.sql` file + `_rollback.sql` counterpart
- Service methods return plain objects (not wrapped in `{ success, data }`)
- API routes use `async (req, res, next)` pattern with try/catch

---

## Pending Scope Items

**All deferred improvements from previous tickets' "Out of Scope" sections that are relevant to this ticket have been presented to the user in the 01/02/03 documents above.**

---

## Files NOT to Change

- `frontend/` — no frontend changes needed
- `docker-compose.yml` — no database changes needed
- `backend/src/migrations/apply.js` — migration order auto-detected

---

*This specification is the contract between planning and execution.*
