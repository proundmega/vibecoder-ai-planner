# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: pending
**Date started**: 2026-07-12
**Date completed**: {{DATE}}
**Author**: AI Assistant
**Feature scope**: Frontend | Backend | Database | Both

---

## Pre-Implementation Checklist

### Planning

- [ ] I have read `01_ARCHITECT_REQUIREMENT.md` — I understand the requirement, scope, and acceptance criteria
- [ ] I have read `02_ARCHITECT_DESIGN.md` — I understand the design, alternatives considered, and risks
- [ ] I have read `03_ARCHITECT_IMPLEMENTATION.md` — I know the actions, dependencies, and testing steps
- [ ] I have identified all assumptions and confirmed they are reasonable
- [ ] I know what is IN scope and OUT of scope
- [ ] I have verified there are no important design decisions that require user input

### Existing Infrastructure Audit

- [ ] I have checked the `project_providers` table (migration 009) — it has `project_id` column, needs migration to root-level
- [ ] I have checked `providerController.js` — all methods scope to `projectId` from URL params
- [ ] I have checked `ProviderService.js` — `resolveProvider(projectId, ticketInfo)` depends on per-project providers
- [ ] I have checked `ProviderRouter.js` — loads providers by project ID
- [ ] I have checked `frontend/src/api/providers.ts` — all functions take `projectId` parameter
- [ ] I have checked `frontend/src/views/ProjectDetail.vue` — Providers tab at lines 558-685
- [ ] I have checked `agents` table — no `provider_id` column, needs new column
- [ ] I have checked `AgentService.js` — create/list/delete don't reference providers
- [ ] I have checked `AgentModal.vue` — only has name input, needs provider selector
- [ ] I have checked Java agent config — `AI_PROVIDER` env var already exists but not tied to DB provider

### Database & Migration

- [ ] New migration needed: remove `project_id` from `project_providers`, make it global
- [ ] New migration needed: add `provider_id` (FK) to `agents` table
- [ ] Rollback files needed for both migrations
- [ ] Migration order: providers first (032), then agents (033)
- [ ] Existing per-project provider data needs migration strategy (assign to a default project or make globally accessible)

### Testing Strategy

- [ ] Backend: ProviderController tests — extend existing or create new for root-level behavior
- [ ] Backend: AgentService tests — add provider_id validation tests
- [ ] Backend: ProviderService tests — ensure resolveProvider works with global providers
- [ ] Frontend: API client tests — update provider functions to not take projectId
- [ ] Frontend: Remove Providers tab from ProjectDetail.vue
- [ ] Frontend: Add Providers section to a root-level page (Dashboard or new page)
- [ ] Frontend: Update AgentModal.vue with provider selector
- [ ] Frontend: Contract tests updated if response shapes change
- [ ] Backend: Bash integration suite for new provider routes
- [ ] **Coverage threshold (60%)**: run `npm run test:coverage` (backend) and `npm test -- --run --coverage` (frontend)

### Configuration Audit

- [ ] No new environment variables needed
- [ ] Existing `AI_PROVIDER` env var in Java agent config remains compatible
- [ ] Backward compatibility: old per-project provider URLs return 410 GONE or redirect

---

## Post-Implementation Checklist

- [ ] All unit tests pass (`npm test` in relevant directory)
- [ ] Backend Jest integration tests pass (`npm run test:integration`)
- [ ] Bash integration suite passes (`cd backend && bash integration-test/run.sh --only`)
- [ ] Linting passes (`npm run lint` in both backend and frontend)
- [ ] Frontend typecheck passes (`npm run typecheck`)
- [ ] Frontend build passes (`npm run build`)
- [ ] Coverage threshold enforced (60% min)
- [ ] Migration rollback tested
- [ ] Generated types regenerated if API response shapes changed
- [ ] OpenAPI JSDoc annotations updated

## When to Ask the User

1. **Provider data migration** — how to handle existing per-project provider data (keep as-is, migrate to global, or deprecate)
2. **Root-level page placement** — where should the global Providers UI live? (Dashboard, new Providers page, or Super Admin)
3. **Agent-provider relationship** — one provider per agent, or multiple? (assumed: one primary)

---

*This checklist prevents agents from skipping planning and jumping straight to coding.*
