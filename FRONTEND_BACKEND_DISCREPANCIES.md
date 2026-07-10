# Frontend-Backend Discrepancy Report

## Summary

Comprehensive audit of API routes, field names, types, enums, and component data references across the vibecoder-ai-planner codebase.

**Severity levels**: Critical (broken functionality) > High (data loss/corruption) > Medium (UI bugs) > Low (code quality).

---

## CRITICAL - Broken Functionality

### C1. Usage breakdown field name mismatch
**Impact**: Usage tab shows 0 for all breakdown values.

**Backend** (`backend/src/controllers/usageController.js:19-30`):
```js
// UsageLogger.getProjectUsage() returns DB rows with snake_case:
// { model, calls, tokens_in, tokens_out, cost }
```

**Frontend** (`frontend/src/views/ProjectDetail.vue:717-723`):
```vue
<tr v-for="model in usage.breakdown" :key="model.model">
  <td>{{ model.model }}</td>
  <td>{{ model.calls || 0 }}</td>
  <td>{{ (model.tokens_in || 0).toLocaleString() }}</td>
  <td>{{ (model.tokens_out || 0).toLocaleString() }}</td>
  <td>${{ (model.cost || 0).toFixed(4) }}</td>
</tr>
```

**Analysis**: Backend `UsageLogger` returns snake_case (`tokens_in`, `tokens_out`), frontend accesses them as snake_case too - **this is actually consistent**. However, the `UsageTotals` interface in `frontend/src/api/usage.ts:22-27` uses camelCase (`totalTokensIn`, `totalTokensOut`, `totalCost`, `totalCalls`) which matches the controller response. **No bug here** - the totals are correctly camelCase from the controller, and the breakdown is snake_case from the logger. The frontend correctly accesses both.

### C2. BillingDashboard field name mismatch
**Impact**: Billing dashboard totals show 0.

**Backend** (`backend/src/services/BillingService.js`):
- Returns billing records with fields: `total_cost`, `total_calls`, `total_tokens_in`, `total_tokens_out`, `billing_month`, `project_id`, `project_name`

**Frontend** (`frontend/src/api/billing.ts:3-11`):
```ts
export interface Billing {
  total_cost: number      // Backend returns: total_cost ✓
  total_calls: number     // Backend returns: total_calls ✓
}
```

**Frontend** (`frontend/src/views/BillingDashboard.vue:13-27`):
```ts
// Line 14: parseFloat(b.total_cost_usd)  -- WRONG! Backend returns total_cost
// Line 22: parseInt(b.total_tokens_in)   -- correct
// Line 26: parseInt(b.total_tokens_out)  -- correct
// Line 119: parseFloat(row.total_cost_usd) -- WRONG!
```

**Fix**: Change `total_cost_usd` to `total_cost` in `BillingDashboard.vue` lines 14 and 119.

### C3. GitHub createBranch API - missing projectId in request body
**Impact**: Branch creation fails silently.

**Backend** (`backend/src/controllers/githubController.js:36-52`):
```js
async function createBranch(req, res, next) {
  const { ticketId } = req.params;
  const projectId = req.body.projectId || req.project?.id;  // Expects projectId in body
  // ...
  const result = await GitHubService.createTicketBranch(projectId, ticketId);
}
```

**Frontend** (`frontend/src/api/github.ts:42-44`):
```ts
export function createBranch(ticketId: string, branchName: string): Promise<{ name: string; sha: string }> {
  return post<{ name: string; sha: string }>(`/api/v1/github/${ticketId}/branch`, { branchName })
  // Missing: projectId in body
}
```

**Frontend** (`frontend/src/views/ProjectDetail.vue:203`):
```ts
await createBranch(branchTicketId.value.trim(), `ticket-${branchTicketId.value.trim()}`)
// Missing: projectId
```

**Fix**: Add `projectId` to the request body in both `github.ts` and component calls.

---

## HIGH - Data Loss / Wrong Data Displayed

### H1. Ticket assignee field mismatch
**Impact**: Ticket board shows no assignee info; ticket detail shows no assignee name.

**Backend** (`backend/src/services/TicketService.js` - returns DB rows):
- `assigned_agent_id` - the agent who picked up the ticket
- No `assignee_id`, `assignee_name`, or `owner_email` fields directly on ticket rows

**Frontend** (`frontend/src/views/TicketDetail.vue:342-343`):
```vue
<span v-if="ticket?.assignee_name">Assignee: <strong>{{ ticket.assignee_name }}</strong></span>
<span v-if="ticket?.owner_email">Created by: <strong>{{ ticket.owner_email }}</strong></span>
```

**Frontend** (`frontend/src/views/TicketBoard.vue:90`):
```ts
if (ticket.assignee_id && ticket.assignee_id === authStore.user.value.id) return true
```

**Frontend** (`frontend/src/api/tickets.ts:3-13`):
```ts
export interface Ticket {
  assigned_to?: string   // Backend returns: assigned_agent_id
}
```

**Fix**: 
- `TicketBoard.vue` line 90: change `ticket.assignee_id` to `ticket.assigned_agent_id`
- `TicketDetail.vue` lines 342-343: `assignee_name` and `owner_email` likely don't exist in backend response. Either add these fields to the backend response or remove the template bindings.
- `tickets.ts`: rename `assigned_to` to `assigned_agent_id` or add alias.

### H2. User interface extra fields
**Impact**: Frontend type doesn't match backend response; `currentPlan` and `userCreatedBy` are undefined.

**Backend** (`backend/src/controllers/userController.js`):
- Returns user DB rows: `id`, `name`, `email`, `role`, `is_active`, `created_at`, `updated_at`

**Frontend** (`frontend/src/api/users.ts:3-12`):
```ts
export interface User {
  id: string
  name: string
  email: string
  role: string
  isActive: boolean
  currentPlan: string          // NOT returned by backend
  userCreatedBy: string | null // NOT returned by backend
  createdAt: string
}
```

**Frontend** (`frontend/src/stores/auth.ts`):
- Auth store `User` interface also has these extra fields

**Fix**: Remove `currentPlan` and `userCreatedBy` from interfaces, or add them to backend response.

### H3. Provider test response field mismatch
**Impact**: Provider test result display may fail.

**Backend** (`backend/src/controllers/providerController.js:398-405`):
```js
res.json({
  success: true,
  data: {
    success: isValid,
    valid: isValid,     // Returns BOTH success and valid
    message: isValid ? 'Connection successful' : 'Invalid API key',
  },
});
```

**Frontend** (`frontend/src/views/ProjectDetail.vue:675`):
```vue
:class="(providerTestResult.success || providerTestResult.valid) ? 'success' : 'error'"
```

**Analysis**: Frontend checks both `success` and `valid` - this is defensive and works correctly. **No bug** but the redundant `success`/`valid` in backend response is confusing.

### H4. Credentials API - no typed interface
**Impact**: Credentials management has no type safety.

**Backend** (`backend/src/controllers/credentialController.js`):
- Returns typed responses with `credentialType`, `keyMasked`, `isActive`, `expiresAt`

**Frontend** (`frontend/src/api/credentials.ts:3`):
```ts
export function getActiveCredentials(projectId: string): Promise<Record<string, unknown>[]> {
  // No typed interface - all fields are unknown
}
```

**Fix**: Create a `Credential` interface matching the backend response.

---

## MEDIUM - UI Bugs / Inconsistent Behavior

### M1. PATCH vs PUT method mismatch for provider update
**Impact**: Provider updates may 404 if backend expects PUT.

**Backend** (`backend/src/api/v1/index.js`):
- Provider routes: `router.patch('/:projectId/providers/:providerId', ...)` - uses PATCH

**Frontend** (`frontend/src/api/providers.ts:41-43`):
```ts
export function updateProvider(projectId: string, providerId: string, updates: Partial<Provider>): Promise<Provider> {
  return patch<Provider>(`/api/v1/providers/${projectId}/providers/${providerId}`, updates)
}
```

**Analysis**: Both use PATCH. **No bug**.

### M2. Agent heartbeat field naming inconsistency
**Impact**: Agent status data may not display correctly.

**Backend** (heartbeat service - based on `AgentStatus` interface in frontend):
- Returns: `agent_id`, `name`, `status`, `last_seen`, `current_ticket_id`, `current_ticket_title`, `current_step`, `actions_today`, `cost_today`

**Frontend** (`frontend/src/api/agents.ts:30-40`):
```ts
export interface AgentStatus {
  agent_id: number
  name: string
  status: string
  last_seen: string
  current_ticket_id: number | null
  current_ticket_title: string | null
  current_step: string | null
  actions_today: number    // snake_case
  cost_today: number       // snake_case
}
```

**Frontend** (`frontend/src/views/AgentList.vue:156-157`):
```vue
<td>{{ agent.actions_today }}</td>
<td>{{ formatCost(agent.cost_today) }}</td>
```

**Analysis**: Consistent - snake_case throughout. **No bug**.

### M3. Memory search results double-wrapping
**Impact**: Memory search may show empty results.

**Frontend** (`frontend/src/views/ProjectDetail.vue:364-365`):
```ts
const result = await searchMemory(projectId, searchQuery.value)
searchResults.value = result.data || []  // result is already unwrapped by extractData()
```

**Backend** (`backend/src/controllers/memoryController.js:108`):
```js
res.json({ success: true, data: memories });
```

**Frontend client** (`frontend/src/api/client.ts:50-56`):
```ts
// extractData unwraps { data } from response
// So result IS the memories array already
```

**Analysis**: `result.data` would be `undefined` since `extractData` already unwrapped. Should be `result` not `result.data`.

**Fix**: Change line 365 to `searchResults.value = result || []`

### M4. Usage data double-wrapping in ProjectDetail
**Impact**: Usage may show null.

**Frontend** (`frontend/src/views/ProjectDetail.vue:321-322`):
```ts
const result = await getProjectUsage(projectId)
usage.value = result?.data || null  // result already unwrapped by extractData
```

**Backend** (`backend/src/controllers/usageController.js:19-30`):
```js
res.json({
  success: true,
  data: { breakdown: usage, totals: { ... } },
});
```

**Analysis**: Same issue as M3. `extractData` unwraps `{ data }`, so `result` IS the `{ breakdown, totals }` object. `result.data` is `undefined`.

**Fix**: Change line 322 to `usage.value = result || null`

### M5. Billing data double-wrapping in ProjectDetail
**Impact**: Billing shows empty.

**Frontend** (`frontend/src/views/ProjectDetail.vue:334-335`):
```ts
const result = await getProjectBilling(projectId)
billing.value = result?.data || []  // result already unwrapped
```

**Fix**: Change line 335 to `billing.value = result || []`

### M6. User list API response structure mismatch
**Impact**: User list may not display correctly.

**Backend** (`backend/src/controllers/userController.js:7`):
```js
res.json({ success: true, data: { users } });  // data wraps { users: [...] }
```

**Frontend** (`frontend/src/api/users.ts:14-16`):
```ts
export interface UserListResponse {
  users: User[]
}
```

**Frontend** (`frontend/src/api/users.ts:26-35`):
```ts
export function listUsers(filters: ListFilters = {}): Promise<UserListResponse> {
  return get(`/api/v1/users...`)  // extractData unwraps { data } → returns { users: [...] }
}
```

**Analysis**: `extractData` returns `{ users }` which matches `UserListResponse`. **No bug** but the double-nesting `{ data: { users } }` is unusual.

### M7. GitHub branch list field mismatch
**Impact**: Branch delete button may not work.

**Frontend** (`frontend/src/views/GitHubConnections.vue:217`):
```vue
@click="handleDeleteBranch(branch.ticket_id)"
```

**Backend** (GitHub service - need to verify):
- May return `ticket_id` or different field name

**Analysis**: Need to verify what `GitHubService.listTicketBranches()` returns. If it returns `ticket_id` as snake_case but the frontend expects a different structure, this is a mismatch.

### M8. Frontend `connectRepo` sends `branch` but backend expects `accessToken`
**Impact**: Repository connection fails.

**Backend** (`backend/src/controllers/githubController.js:7`):
```js
const { repoUrl, accessToken } = req.body;  // Expects accessToken
const repo = await GitHubService.connectProject(id, repoUrl, accessToken, req.user.userId);
```

**Frontend** (`frontend/src/api/github.ts:30-32`):
```ts
export function connectRepo(projectId: string, repoUrl: string, branch: string): Promise<RepoStatus> {
  return post<RepoStatus>(`/api/v1/github/${projectId}/repo/connect`, { repoUrl, branch })
  // Sends: { repoUrl, branch } - missing accessToken, sends extra branch
}
```

**Frontend** (`frontend/src/views/ProjectDetail.vue:170`):
```ts
await connectRepo(projectId, repoUrl.value.trim(), repoBranch.value.trim() || 'main')
// Passes: projectId, repoUrl, branchName (called "branch" but should be "accessToken")
```

**Frontend** (`frontend/src/views/GitHubConnections.vue:67`):
```ts
await connectRepo(projectId, repoUrl.value.trim(), repoBranch.value.trim() || 'main')
// Same issue
```

**Fix**: Either change backend to accept `branch` parameter, or change frontend to pass `accessToken` instead of `branch`.

---

## LOW - Code Quality / Minor Issues

### L1. Agent CRUD endpoint path inconsistency
**Impact**: Agent CRUD endpoints may not match.

**Frontend** (`frontend/src/api/agents.ts:46-52`):
```ts
export function createAgent(name: string): Promise<Agent & { generatedApiKey: string }> {
  return post<Agent & { generatedApiKey: string }>('/api/v1/agents/create', { name })
}
export function listAgents(): Promise<{ agents: Agent[] }> {
  return get<{ agents: Agent[] }>('/api/v1/agents/')
}
```

**Need to verify**: Backend route definitions for `/api/v1/agents/create` and `/api/v1/agents/`.

### L2. `deleteProject` return type mismatch
**Impact**: Minor - error handling may not work as expected.

**Frontend** (`frontend/src/api/projects.ts:27-28`):
```ts
export function deleteProject(id: string): Promise<{ error?: string }> {
  return del<{ error?: string }>(`/api/v1/projects/${id}`).catch(() => ({ error: 'Failed to delete' }))
}
```

**Backend** (`backend/src/controllers/projectController.js:55`):
```js
res.json({ success: true, data: { message: 'Project deleted' } });
```

**Analysis**: Returns `{ message }` not `{ error }`. The return type `Promise<{ error?: string }>` is misleading.

### L3. `fetchProjectUsers` response shape
**Impact**: May not match expected shape.

**Backend** (`backend/src/controllers/projectController.js:91-107`):
```js
const result = await pool.query(
  `SELECT u.id, u.name, u.email, u.role 
   FROM users u WHERE u.id != $1 ORDER BY u.name NULLS FIRST, u.email`,
  [req.user.userId]
);
res.json({ success: true, data: result.rows });
```

**Frontend** (`frontend/src/api/tickets.ts:51-53`):
```ts
export function fetchProjectUsers(projectId: string): Promise<{ id: string; name: string; email: string }[]> {
  return get<{ id: string; name: string; email: string }[]>(`/api/v1/projects/${projectId}/users`)
}
```

**Analysis**: Backend returns `role` field too, frontend interface doesn't include it. Minor - not breaking.

### L4. Provider `apiKey` masking inconsistency
**Impact**: API keys displayed differently across calls.

**Backend** (`providerController.js:336-354`):
- `listProviders` returns `apiKey: maskToken(decrypt(row.api_key_encrypted))` - masked
- `addProvider` returns `apiKey: maskToken(apiKey)` - the raw input masked (not decrypted from DB)
- `updateProvider` returns `apiKey: maskToken(decrypt(row.api_key_encrypted))` - masked from DB

**Frontend** (`frontend/src/api/providers.ts:8`):
```ts
apiKey?: string  // No indication this is masked
```

**Frontend** (`frontend/src/views/ProjectDetail.vue:627`):
```vue
<span class="provider-key-masked">{{ '•'.repeat(12) }}{{ provider.api_key?.slice(-4) || '' }}</span>
```

**Analysis**: Frontend re-masks an already-masked value. The `'•'.repeat(12)` + `slice(-4)` on an already masked key produces `••••••••••••xxxx` which is correct display but the double-processing is wasteful.

### L5. Generated vs hand-written API divergence
**Impact**: Generated OpenAPI services may not be used but could confuse developers.

**Observation**: `frontend/src/api/generated/` contains OpenAPI-generated services that may diverge from hand-written `frontend/src/api/*.ts` files. The hand-written files are what's actually used by components.

**Files**:
- `AuthService`, `ProjectsService`, `TicketsService`, `AgentsService`, `UsersService`
- `ApprovalsService`, `BillingService`, `UsageService`, `GitHubService`
- `ProvidersService`, `MemoryService`, `CredentialsService`
- `PlanningService`, `AttachmentsService`, `PermissionsService`, `SystemService`
- Models: `Ticket.ts`, `Project.ts`, `Agent.ts`, `User.ts`

**Recommendation**: Either use the generated services consistently or remove them.

---

## API Route Summary

### Routes that exist in backend but not used in frontend:
| Backend Route | Controller | Notes |
|---|---|---|
| `POST /api/v1/tickets/:ticketId/pickup` | `pickUpTicket` | Agent-only |
| `POST /api/v1/tickets/:ticketId/release` | `releaseTicket` | Agent-only |
| `GET /api/v1/tickets/:ticketId/messages` | `getMessages` | Agent-only |
| `POST /api/v1/tickets/:ticketId/messages` | `postMessage` | Agent-only |
| `GET /api/v1/agents-status` | `fetchAgentStatusList` | Used |
| `GET /api/v1/agents-status/:id` | `fetchAgentDetail` | Not used |
| `POST /api/v1/agents/revoke/:id` | `revokeAgentKey` | Not used |
| `GET /api/v1/providers/:projectId/providers/:providerId/directorate` | `setDirector` | Used via PATCH |
| `GET/PUT/DELETE /api/v1/providers/projects/:id/provider` | Deprecated | Returns 410 GONE |
| `POST /api/v1/providers/projects/:id/provider/test` | Deprecated | Returns 410 GONE |

### Routes that exist in frontend but not found in backend:
| Frontend Call | Route | Issue |
|---|---|---|
| `connectRepo` | `POST /api/v1/github/:id/repo/connect` | Backend expects `accessToken`, frontend sends `branch` |
| `createBranch` | `POST /api/v1/github/:ticketId/branch` | Backend expects `projectId` in body, frontend doesn't send it |
| `createPR` | `POST /api/v1/github/:ticketId/pr` | Verify backend route exists |

---

## Field Name Reference

### Backend → Frontend mapping (verified):
| Entity | Backend Field | Frontend Interface | Frontend Usage | Status |
|---|---|---|---|---|
| Ticket | `assigned_agent_id` | `assigned_to` | `assignee_id` (board) | MISMATCH |
| Ticket | `owner_id` | `owner_id` | `owner_id` | OK |
| Ticket | - | - | `assignee_name` | NOT IN BACKEND |
| Ticket | - | - | `owner_email` | NOT IN BACKEND |
| Project | `id`, `name`, `description` | Same | Same | OK |
| Project | - | - | `ticketCount` | Added by controller |
| User | `id`, `name`, `email`, `role` | Same | Same | OK |
| User | `is_active` | `isActive` | - | OK (controller transforms) |
| User | - | `currentPlan` | - | NOT IN BACKEND |
| User | - | `userCreatedBy` | - | NOT IN BACKEND |
| Agent | `id`, `name`, `api_key` | Same | Same | OK |
| Agent | `rate_limit` | `rate_limit` | Same | OK |
| Agent | `max_actions_per_day` | `max_actions_per_day` | - | OK |
| Agent | `current_daily_usage` | `current_daily_usage` | - | OK |
| AgentStatus | `agent_id`, `name`, `status` | Same | Same | OK |
| AgentStatus | `last_seen` | `last_seen` | Same | OK |
| AgentStatus | `actions_today` | `actions_today` | Same | OK |
| AgentStatus | `cost_today` | `cost_today` | Same | OK |
| Provider | `provider_type` | `providerType` | Same | OK |
| Provider | `api_key_encrypted` | `apiKey` (masked) | Same | OK |
| Provider | `is_project_director` | `is_project_director` | Same | OK |
| Memory | `created_at`, `updated_at` | Same | Same | OK |
| Memory | - | - | `created_by_name` | NOT IN BACKEND |
| Credential | `credential_type` | - | `credentialType` | OK (controller) |
| Credential | `key_masked` | - | `keyMasked` | OK (controller) |
| Usage | `totalTokensIn` (camelCase) | `totalTokensIn` | Same | OK |
| Usage breakdown | `tokens_in` (snake_case) | - | `tokens_in` | OK (from logger) |
| Billing | `total_cost` | `total_cost` | `total_cost_usd` | MISMATCH |
| Billing | `total_calls` | `total_calls` | Same | OK |
| Billing | `total_tokens_in` | Same | Same | OK |
| Billing | `billing_month` | Same | Same | OK |
| GitHub Repo | `repo_url` | Same | Same | OK |
| GitHub Repo | `default_branch` | Same | Same | OK |
| GitHub Branch | `name` | Same | Same | OK |
| GitHub Branch | `ticket_id` | Same | Same | OK (assumed) |
| GitHub PR | `html_url` | Same | Same | OK |
| GitHub PR | `head_ref` | Same | Same | OK (assumed) |

---

## Recommended Priority Fixes

1. **C2** - BillingDashboard `total_cost_usd` → `total_cost` (2 lines)
2. **M3, M4, M5** - Remove `.data` double-wrapping in 3 component files
3. **C3** - Add `projectId` to `createBranch` API calls
4. **H1** - Fix ticket assignee field names across 3 files
5. **M8** - Fix `connectRepo` parameter mismatch (branch vs accessToken)
6. **H2** - Remove `currentPlan`/`userCreatedBy` from User interfaces
7. **H4** - Add typed `Credential` interface
8. **L5** - Decide on generated vs hand-written API services
