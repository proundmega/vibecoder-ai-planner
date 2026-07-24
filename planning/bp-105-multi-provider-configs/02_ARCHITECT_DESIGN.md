# 02_ARCHITECT_DESIGN.md — Multi-Provider Configs Design

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, `04_SPECIFICATION.md`

---

## Problem Statement

System supports a single global provider. Operators need multiple named provider configs per project (e.g., "gpt-4 for production", "claude for staging").

---

## Design

### Database Changes

**Migration**: `backend/src/migrations/XXX_add_project_id_to_providers.sql`

```sql
ALTER TABLE providers ADD COLUMN project_id UUID REFERENCES projects(id);
CREATE INDEX idx_providers_project_id ON providers(project_id);
```

- `project_id` is nullable — `NULL` = global provider
- Existing providers remain global (project_id = NULL)
- New providers can be scoped to a project

### Provider Resolution Logic

**MODIFY**: `backend/src/services/ProviderService.js`

Current flow:
```
1. getGlobalProvider() — returns single provider with is_project_director = true
2. resolveProvider(ticketInfo) — matches labels/priority via routing rules
```

New flow:
```
1. getProjectProviders(projectId) — returns providers for project (project_id = X) + global (project_id IS NULL)
2. resolveProvider(ticketInfo, projectId) — checks project-scoped first, then global
3. Routing rules apply within each provider config
```

### Implementation

```javascript
// ProviderService.js

async getProjectProviders(projectId) {
  const result = await pool.query(
    `SELECT * FROM providers
     WHERE (project_id = $1 OR project_id IS NULL) AND is_active = true
     ORDER BY project_id IS NULL ASC`,  // Global providers last
    [projectId]
  );
  return result.rows;
}

async resolveProvider(ticketInfo, projectId = null) {
  const providers = await this.getProjectProviders(projectId);
  
  if (providers.length === 0) {
    throw new Error('No active provider configuration found');
  }
  
  // Check project-scoped providers first
  const projectProviders = providers.filter(p => p.project_id === projectId);
  const globalProviders = providers.filter(p => p.project_id === null);
  
  // Try project-scoped providers
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

### API Changes

**MODIFY**: `backend/src/api/providers.js`

Add `project_id` query parameter filter:
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

---

## Risks and Edge Cases

- **[Backward compatibility]**: Existing providers have `project_id = NULL`. They remain global and continue to work.
- **[Multiple global providers]**: `ORDER BY project_id IS NULL ASC` ensures project-scoped providers are checked first, global providers last.
- **[Project deleted]**: If a project is deleted, its providers remain with `project_id = X` (orphaned). Consider cascade delete or set to NULL.
- **[Routing rules conflict]**: If multiple project-scoped providers have matching rules, first match wins (ordered by creation date).

---

## Alternative Designs Considered

### Alternative 1: Separate `project_providers` junction table
- **Pros**: Clean many-to-many, easy to query
- **Cons**: Overkill for one-to-many (project → providers)
- **Decision**: Add `project_id` column to `providers` table — simpler

### Alternative 2: Provider priority field
- **Pros**: Explicit ordering
- **Cons**: Complex, hard to maintain
- **Decision**: Project-scoped providers always take precedence over global — simpler mental model

---

## Specification Generation

- [ ] `04_SPECIFICATION.md` has been created with exact file operations
- [ ] Test expectations are specific
- [ ] Pending scope items presented to user

---

*This design document guides implementation.*
