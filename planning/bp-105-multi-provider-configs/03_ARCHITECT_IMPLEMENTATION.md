# 03_ARCHITECT_IMPLEMENTATION.md — Multi-Provider Configs Implementation Plan

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `04_SPECIFICATION.md`

---

## Implementation Phases

### Phase 1: Database Migration

**CREATE**: `backend/src/migrations/XXX_add_project_id_to_providers.sql`

```sql
ALTER TABLE providers ADD COLUMN project_id UUID REFERENCES projects(id);
CREATE INDEX idx_providers_project_id ON providers(project_id);
```

**CREATE**: `backend/src/migrations/XXX_add_project_id_to_providers_rollback.sql`

```sql
DROP INDEX IF EXISTS idx_providers_project_id;
ALTER TABLE providers DROP COLUMN IF EXISTS project_id;
```

### Phase 2: Update ProviderService

**MODIFY**: `backend/src/services/ProviderService.js`

Replace `getGlobalProvider()` with `getProjectProviders(projectId)`:
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

Update `resolveProvider(ticketInfo)` to accept `projectId`:
```javascript
async resolveProvider(ticketInfo, projectId = null) {
  const providers = await this.getProjectProviders(projectId);
  // ... routing logic across all providers
}
```

### Phase 3: Update Providers API

**MODIFY**: `backend/src/api/providers.js`

Update `GET /providers` to accept `project_id` query parameter.

### Phase 4: Tests

**MODIFY**: `backend/src/__tests__/providerService.test.js`

Add tests:
- `resolveProvider()` checks project-scoped providers first
- `resolveProvider()` falls back to global provider
- `getProjectProviders()` returns correct providers for project

### Phase 5: Verify & Build

1. Run `cd backend && npm run db:migrate` — apply migration
2. Run `cd backend && npm test` — verify tests pass
3. Run `cd backend && npm run test:coverage` — verify 60% coverage
4. Run `cd backend && npm run lint` — verify no lint errors

---

## Files Changed

```
backend/src/migrations/XXX_add_project_id_to_providers.sql      → CREATE
backend/src/migrations/XXX_add_project_id_to_providers_rollback.sql → CREATE
backend/src/services/ProviderService.js                         → MODIFY
backend/src/api/providers.js                                    → MODIFY
backend/src/__tests__/providerService.test.js                   → MODIFY
```

---

### i) Code Review Checklist

- [ ] Migration adds `project_id` column with foreign key
- [ ] Migration creates index on `project_id`
- [ ] `getProjectProviders()` returns project-scoped + global providers
- [ ] `resolveProvider()` checks project-scoped first, global fallback
- [ ] `GET /providers?project_id=X` filters by project
- [ ] All existing provider tests still pass
- [ ] `npm run test:coverage` passes (60% min threshold)
- [ ] **Coverage threshold enforced**: `npm run test:coverage` — min 60% lines, functions, branches, statements

### j) Post-Deploy Verification

1. [ ] Backend: `npm test` passes
2. [ ] Backend: `npm run test:coverage` passes (60% min threshold)
3. [ ] Backend: `npm run lint` passes
4. [ ] Migration applies successfully
5. [ ] Provider resolution works with project-scoped providers
6. [ ] Global provider fallback works
7. [ ] `docker compose up --build` starts without errors

---

*Fill in all sections before starting implementation.*
