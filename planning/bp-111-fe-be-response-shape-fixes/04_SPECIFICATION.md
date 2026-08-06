# 04_SPECIFICATION.md — Model Execution Spec

**Generated from**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`
**Target model**: 34B local model
**Date**: 2026-08-06

---

## Test-First Requirement

**Test stub files MUST be extended before any production code.** The model MUST:
1. EXTEND the 6 test files below with `it` blocks that assert the CORRECT shapes/payloads (these fail against current code — that is the regression proof)
2. Implement the production code changes (R1–R5)
3. Fill the stub blocks with assertions and run the suite to green

Do NOT defer test creation.

---

## File Operations

Each entry specifies exactly what the model should produce. The model MUST NOT create, modify, or delete any file not listed here.

### MODIFY: `frontend/src/api/usage.ts`

**Replace `Usage` interface** (currently lines 3-11):
```ts
export interface Usage {
  provider_type?: string
  model: string
  total_in: number
  total_out: number
  total_cost: number
  total_calls: number
}
```
**Do NOT change**: `UsageResponse` (`{ breakdown: Usage[]; totals: UsageTotals }`), `UsageTotals` (camelCase), `ModelPricing`, `getProjectUsage`/`getUserUsage`/`getModelPricing`.

### MODIFY: `frontend/src/views/ProjectDetail.vue`

**Lines 241-244** (usage breakdown `<td>` cells), keep `:key="model.model"`:
```html
<td>{{ model.total_calls || 0 }}</td>
<td>{{ (model.total_in || 0).toLocaleString() }}</td>
<td>{{ (model.total_out || 0).toLocaleString() }}</td>
<td>${{ (model.total_cost || 0).toFixed(4) }}</td>
```
No other template change.

### MODIFY: `frontend/src/api/billing.ts`

**Replace `Billing` interface** (lines 3-11):
```ts
export interface Billing {
  provider_type: string
  model: string
  total_cost: number
  total_in: number
  total_out: number
  total_calls: number
  billing_month?: string
  project_id?: string
}
```
**Change `getProjectBilling`** (lines 13-14):
```ts
export function getProjectBilling(projectId: string): Promise<Billing[] | null> {
  return get<Billing[]>(`/api/v1/billing/projects/${projectId}/billing`).catch(() => null) as Promise<Billing[] | null>
}
```
`getUserBilling` unchanged (`Billing[]`).

### MODIFY: `frontend/src/composables/useUsage.ts`

**Line 31** in `loadBilling`:
```ts
billing.value = result ?? []
```

### MODIFY: `frontend/src/api/github.ts`

**Replace `createPR`** (line 56):
```ts
export function createPR(ticketId: string, description: string, projectId?: string): Promise<PullRequest> {
  return post<PullRequest>(`/api/v1/github/${ticketId}/pr`, { description, projectId })
}
```
`PullRequest` interface unchanged.

### MODIFY: `frontend/src/views/GitHubConnections.vue`

**Line 138**:
```ts
await createPR(prTicketId.value.trim(), prBody.value.trim())
```
Keep `prTitle`/`prBranchName` refs, inputs (lines 240, 242), and the submit guard (line 133).

### MODIFY: `frontend/src/api/phases.ts`

**Change return types** (keep `Phase`/`AllowedPhase` interfaces):
```ts
export function fetchPhases(ticketId: string): Promise<{ phase: string }> {
  return get(`/api/v1/tickets/${ticketId}/phases/current`)
}
export function fetchAllowedPhases(ticketId: string): Promise<{ allowed: AllowedPhase[] }> {
  return get(`/api/v1/tickets/${ticketId}/phases/allowed`)
}
export interface PhaseTransitionResult { ticketId: string; fromPhase: string; toPhase: string; status: string }
export function transitionPhase(ticketId: string, targetPhase: string, metadata: Record<string, unknown> = {}, actorType: string = 'human'): Promise<PhaseTransitionResult> {
  return post(`/api/v1/tickets/${ticketId}/phases/transition`, {
    toPhase: targetPhase,
    actorType,
    metadata: Object.keys(metadata).length > 0 ? metadata : null,
  })
}
```
`fetchPhaseHistory` unchanged (`Phase[]`).

### MODIFY: `frontend/src/api/templates.ts`

**Replace `Template` interface** (lines 3-9):
```ts
export interface Template {
  id: string
  name: string
  project_id: string
  description: string | null
  file_definitions: { key: string; content: string }[]
  created_at: string
  updated_at: string
}
```
**Replace `createTemplate`** (line 17) and **`updateTemplate`** (line 22):
```ts
export function createTemplate(projectId: string, data: { name: string; description?: string; file_definitions: { key: string; content: string }[] }): Promise<Template> {
  return post(`/api/v1/projects/${projectId}/templates`, data)
}
export function updateTemplate(projectId: string, templateId: string, data: Partial<{ name: string; description?: string; file_definitions: { key: string; content: string }[] }>): Promise<Template> {
  return put(`/api/v1/projects/${projectId}/templates/${templateId}`, data)
}
```

---

## Test Expectations

### Frontend Unit Tests

#### `frontend/src/__tests__/usage.test.js` (EXTEND)
```
✓ [R1] getProjectUsage breakdown rows use total_in/total_out/total_cost/total_calls (not tokens_in/cost)
  get.mockResolvedValue({ breakdown: [{ model: 'gpt-4', total_in: 100, total_out: 50, total_cost: 0.01, total_calls: 2 }], totals: {} })
  const r = await usage.getProjectUsage('p1'); expect(r.breakdown[0].total_in).toBe(100); expect(r.breakdown[0].total_cost).toBe(0.01)
```
#### `frontend/src/__tests__/billing.test.js` (EXTEND)
```
✓ [R2] getProjectBilling returns the array (not a single object)
  get.mockResolvedValue([{ provider_type: 'openai', model: 'gpt-4', total_cost: 1.5 }])
  const r = await billing.getProjectBilling('p1'); expect(Array.isArray(r)).toBe(true); expect(r[0].total_cost).toBe(1.5)
✓ [R2] getProjectBilling returns null on error (existing pattern preserved)
```
#### `frontend/src/__tests__/useUsage.test.ts` (EXTEND)
```
✓ [R2] loadBilling stores a flat array (no nested [result])
  mockGetProjectBilling.mockResolvedValue([{ provider_type: 'openai', model: 'gpt-4', total_cost: 1.5 }])
  await usage.loadBilling()
  expect(usage.billing.value).toEqual([{ provider_type: 'openai', model: 'gpt-4', total_cost: 1.5 }])  // NOT [[...]]
✓ [R2] loadBilling sets [] when result is null
  mockGetProjectBilling.mockResolvedValue(null); await usage.loadBilling(); expect(usage.billing.value).toEqual([])
```
#### `frontend/src/__tests__/github.test.js` (EXTEND)
```
✓ [R3] createPR posts { description } (not { title, body, branchName })
  post.mockResolvedValue({ id: 1 })
  await github.createPR('t1', 'my description')
  expect(post).toHaveBeenCalledWith('/api/v1/github/t1/pr', { description: 'my description', projectId: undefined })
```
#### `frontend/src/__tests__/phases.test.js` (EXTEND)
```
✓ [R4] fetchPhases returns { phase } (post-extractData shape)
  get.mockResolvedValue({ phase: 'in_progress' })
  const r = await phases.fetchPhases('t1'); expect(r).toEqual({ phase: 'in_progress' })
✓ [R4] fetchAllowedPhases returns { allowed }
  get.mockResolvedValue({ allowed: ['review', 'backlog'] })
  const r = await phases.fetchAllowedPhases('t1'); expect(r.allowed).toEqual(['review', 'backlog'])
✓ [R4] transitionPhase posts toPhase/actorType/metadata
  post.mockResolvedValue({ ticketId: 't1', fromPhase: 'a', toPhase: 'b', status: 'ok' })
  const r = await phases.transitionPhase('t1', 'b'); expect(post).toHaveBeenCalledWith('/api/v1/tickets/t1/phases/transition', expect.objectContaining({ toPhase: 'b', actorType: 'human' }))
```
#### `frontend/src/__tests__/templates.test.js` (EXTEND)
```
✓ [R5] createTemplate posts { name, description, file_definitions }
  post.mockResolvedValue({ id: '1' })
  await templates.createTemplate('p1', { name: 'n', file_definitions: [{ key: 'a', content: 'b' }] })
  expect(post).toHaveBeenCalledWith('/api/v1/projects/p1/templates', { name: 'n', file_definitions: [{ key: 'a', content: 'b' }] })
```

**Minimum**: 1 happy-path assertion per changed function (6 test files). Existing `.catch(() => null)`/error tests preserved.

---

## Edge Cases to Handle

1. **Empty breakdown** (`ProjectDetail.vue`): `v-if="usageData?.breakdown && usageData.breakdown.length > 0"` guards — no change; do not add new handling.
2. **Empty billing** (`useUsage.ts`): `result ?? []` → template empty state triggers; ensure `billing.value` is always an array.
3. **PR empty body** (`createPR`): backend uses `description || ticket.description` fallback — sending `''`/`undefined` is safe.
4. **Phase `metadata` empty**: `transitionPhase` sends `metadata: null` when no keys — unchanged behavior, only type changes.
5. **Billing `billing_month`**: optional — some rows lack it; interface marks it optional.

---

## Existing Code Patterns to Follow

- Use `<script setup>` in `.vue` files; existing refs untouched
- Import `{ get, post, put, del, patch }` from `'./client'` in api modules (unchanged)
- API client error handling: `.catch(() => null)` for single, `.catch(() => [])` for lists (preserve)
- Vitest: `vi.mock('../api/client', () => ({ get: vi.fn(), post: vi.fn(), ... }))` then `const { get } = await import('../api/client')`
- TypeScript strict: no `noUnusedLocals`/`noUnusedParameters` violations (removed `title`/`body`/`branchName` params in `createPR`)

---

## Pending Scope Items

**All deferred improvements from bp-111 completed in same session (2026-08-06):**

| # | From Ticket | Improvement | Category | Status |
|---|-------------|-------------|----------|--------|
| 1 | R3 (this ticket) | PR form `prTitle`/`prBranchName` inputs ignored by backend (derives from ticket); drop/hide inputs | UX | ✅ Done — removed inputs, simplified guard |
| 2 | fg-13 F6 | Generated API client stale/unused; regenerate or delete | Developer experience | ✅ Done (fg-13) |
| 3 | fg-13 | `postWithHeaders` dead export | Developer experience | ✅ Done — removed from client.ts |
| 4 | bp-80 | Route-mount drift audit tooling | Developer experience | ✅ Done — scripts/route-mount-audit.js |

---

## Files NOT to Change

- `backend/**` — backend is correct; all shapes are the source of truth
- `frontend/src/api/client.ts` — `extractData` semantics unchanged
- `frontend/src/views/PhaseFlow.vue` — already reads `.phase`/`.allowed` correctly
- `frontend/src/views/ProjectTemplates.vue` — already sends `file_definitions`
- `frontend/src/api/generated/**` — handled in fg-13 F6
- `frontend/src/api/validator.ts`, `frontend/src/__tests__/api-contract.test.ts` — no backend shape change

---

*This specification is the contract between planning and execution. If the model cannot produce code matching this spec, it should request human feedback rather than guessing.*
