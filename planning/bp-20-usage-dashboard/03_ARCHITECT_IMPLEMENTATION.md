# 03_ARCHITECT_IMPLEMENTATION.md — Usage Dashboard

**Status**: planned
**Priority**: P1 (High)
**Effort**: Small (~1-2 hours)
**Author**: AI Assistant
**Date created**: 2026-06-24
**Date completed**: TBD
**PR**: TBD
**Branch**: bp-20-usage-dashboard

## Implementation Plan

### Phase 1: Wire up dead API functions

1. **Verify `getUserUsage()` and `getModelPricing()`** in `frontend/src/api/usage.js` — they already exist and make correct API calls. No changes needed.

### Phase 2: Add Usage tab to Dashboard.vue

2. **Add tab state** to `Dashboard.vue`:
   ```javascript
   const activeTab = ref('projects')
   const tabs = [
     { id: 'projects', label: 'Projects' },
     { id: 'usage', label: 'Usage' },
   ]
   ```

3. **Add tab navigation** — render tabs above project list

4. **Add Usage tab content**:
   - `getUserUsage()` call on mount (or when Usage tab is activated)
   - `getModelPricing()` call on mount
   - Per-project usage: iterate over projects, call `getProjectUsage(p.id)` for each
   - Render per-project usage table (project name, tokens, cost)
   - Render pricing reference table

5. **Extract usage loading to a function**:
   ```javascript
   async function loadUsageData() {
     try {
       const [userUsage, pricing] = await Promise.all([
         getUserUsage(),
         getModelPricing()
       ])
       userUsageData.value = userUsage
       pricingData.value = pricing
      
       const projectUsages = await Promise.all(
         projects.value.map(p => getProjectUsage(p.id))
       )
       projectUsageData.value = projectUsages
     } catch (err) {
       console.error('Failed to load usage data:', err)
     }
   }
   ```

### Phase 3: Verify

6. `cd frontend && npm run lint` — zero errors
7. `cd frontend && npm run typecheck` — zero errors
8. `cd frontend && npm test -- --run` — all pass
9. `cd frontend && npm run build` — succeeds

## Rollback Plan

Revert Dashboard.vue changes. No other files affected.

---

*Ready for implementation.*
