# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: completed
**Date started**: 2026-07-12
**Date completed**: 2026-07-15
**Author**: AI Assistant
**Feature scope**: Backend

---

## Pre-Implementation Checklist

### Planning

- [ ] I have read `01_ARCHITECT_REQUIREMENT.md` — I understand the requirement
- [ ] I have read `02_ARCHITECT_DESIGN.md` — I understand the design
- [ ] I have read `03_ARCHITECT_IMPLEMENTATION.md` — I know the actions and dependencies
- [ ] I have identified all assumptions and confirmed they are reasonable
- [ ] I know what is IN scope and OUT of scope

### Existing Infrastructure Audit

- [ ] I have checked `PoolManager.js` — `requestAgent()` passes provider config as env vars
- [ ] I have checked `pool.js` route — accepts `provider_config` from request body
- [ ] I have checked `validators/pool.js` — `provider_config` is `Joi.object().optional()` (no schema)
- [ ] I have checked `ProviderService.resolveProvider()` — returns config from `project_providers` (needs update for global providers)
- [ ] I have checked `ProviderRouter.js` — loads providers by project ID (needs update)
- [ ] I have checked `ProvisioningService.js` — `spawnAgent()` passes env as-is
- [ ] I have checked `agents` table — has `provider_id` (from bp-01)
- [ ] I have checked `providers` table — global, has all provider fields

### Database & Migration

- [ ] No new migrations needed — uses existing tables from bp-01
- [ ] Provider routes changed in bp-01 (no projectId prefix)

### Testing Strategy

- [ ] Backend: Test `PoolManager.requestAgent()` with provider resolution
- [ ] Backend: Test that correct env vars are passed (including AI_PROVIDER)
- [ ] Backend: Test `ProviderService.resolveProvider()` with global providers
- [ ] Backend: Test pool route with provider resolution
- [ ] Existing pool manager tests need updating (they pass provider_config manually)

### Configuration Audit

- [ ] No new environment variables
- [ ] Existing POOL_MANAGER env vars unchanged
- [ ] Backward compatibility: old `provider_config` shape still works

---

## Post-Implementation Checklist

- [ ] Backend: `npm test` passes
- [ ] Backend: `npm run lint` passes
- [ ] PoolManager passes correct env vars to containers
- [ ] AI_PROVIDER env var is included (currently missing)
- [ ] AI_MAX_TOKENS env var is included (currently missing)
- [ ] Provider resolution works with global providers

---

## When to Ask the User

1. **Provider resolution for pools** — Should pool requests resolve provider from a project context, or from the agent's provider_id? (Since pools are ephemeral, there's no agent record yet.)

---

*This checklist prevents agents from skipping planning and jumping straight to coding.*
