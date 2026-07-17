# 02_ARCHITECT_DESIGN.md — Frontend Testing Strategy

**Status**: pending
**Date started**: 2026-07-17

---

## Design

### 1. `diff.ts` Unit Tests

**File**: `src/__tests__/diff.test.ts`

Two pure functions, straightforward assertions on return values.

```
countLines:
  - null/undefined → 0
  - empty string → 0
  - single line → 1
  - multi-line → N

computePatch:
  - new file (oldContent null) → @@ -0,0 +1,N @@
  - deleted file (newContent null) → @@ -1,N +0,0 @@
  - modified file → proper unified diff with context lines
  - identical content → no diff
  - empty strings → empty patch
```

### 2. API Client Contract Tests

**Files**: `src/__tests__/api-*.test.ts` (5 files, one per API client)

Pattern: mock `@/api/client`, verify `get/post/put/patch/del` called with correct args.

```javascript
vi.mock('@/api/client', () => ({
  get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn()
}))

describe('computeNodes API', () => {
  it('listComputeNodes calls GET /api/v1/compute-nodes', () => {
    listComputeNodes()
    expect(get).toHaveBeenCalledWith('/api/v1/compute-nodes')
  })
  
  it('createComputeNode calls POST with correct body', () => {
    createComputeNode({ name: 'test', sshHost: '1.2.3.4' })
    expect(post).toHaveBeenCalledWith('/api/v1/compute-nodes', {
      name: 'test', sshHost: '1.2.3.4'
    })
  })
})
```

Notable edge cases:
- `credentials.ts`: `getActiveCredentials` has `.catch(() => [])` — verify it never rejects
- `computeNodes.ts`: `getRunningContainers` is a stub returning `[]` — verify the stub behavior
- `review.ts`: `getLocalDiff` unwraps `{ files }` envelope — verify the transformation

### 3. Composable Extraction from `ProjectDetail.vue`

**Current state**: 1128 lines, ~280 lines of script logic, 28 reactive refs, 12 async functions.

**Extraction plan**: Each tab's logic becomes a composable. The view becomes a thin wrapper.

#### `useGitHub(projectId: string)`

```typescript
export function useGitHub(projectId: string) {
  const repo = ref<RepoStatus | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const success = ref<string | null>(null)
  const showConnectForm = ref(false)
  const branches = ref<Branch[]>([])
  const prs = ref<PR[]>([])

  async function loadGitHub() { ... }
  async function connect() { ... }
  async function disconnect() { ... }
  async function createBranch(ticketId: string) { ... }
  async function loadBranches() { ... }
  async function loadPRs() { ... }

  return { repo, loading, error, success, showConnectForm, branches, prs,
           loadGitHub, connect, disconnect, createBranch, loadBranches, loadPRs }
}
```

**Test file**: `src/__tests__/useGitHub.test.ts`
- loads repo status on init
- connects a repo, verifies API call and state updates
- disconnects, verifies state cleared
- creates a branch, verifies API call
- handles connection error gracefully

#### `useUsage(projectId: string)`

```typescript
export function useUsage(projectId: string) {
  const usage = ref<UsageData | null>(null)
  const usageLoading = ref(false)
  const usageError = ref<string | null>(null)
  const billing = ref<BillingData[] | null>(null)
  const billingLoading = ref(false)
  const billingError = ref<string | null>(null)

  async function loadUsage() { ... }
  async function loadBilling() { ... }

  return { usage, usageLoading, usageError, billing, billingLoading, billingError,
           loadUsage, loadBilling }
}
```

**Test file**: `src/__tests__/useUsage.test.ts`
- loads usage data
- loads billing data
- handles loading/error states

#### `useMemory(projectId: string)`

```typescript
export function useMemory(projectId: string) {
  const memories = ref<Memory[]>([])
  const memoryLoading = ref(false)
  const showAddMemory = ref(false)
  const searchQuery = ref('')
  const searchResults = ref<Memory[]>([])
  const isSearching = ref(false)
  const editingMemory = ref<Memory | null>(null)

  async function loadMemory() { ... }
  async function handleSearch() { ... }
  async function handleAddMemory(content: string) { ... }
  async function handleUpdateMemory(content: string) { ... }
  async function handleDeleteMemory(id: string) { ... }

  return { memories, memoryLoading, showAddMemory, searchQuery, searchResults,
           isSearching, editingMemory, loadMemory, handleSearch, handleAddMemory,
           handleUpdateMemory, handleDeleteMemory }
}
```

**Test file**: `src/__tests__/useMemory.test.ts`
- loads memories
- searches memories
- creates/updates/deletes memory
- handles loading/error states

#### `useTabNavigation(tabs: TabConfig[])`

```typescript
export interface TabConfig {
  name: string
  key: string
  lazyLoad?: () => Promise<void>
}

export function useTabNavigation(tabs: TabConfig[]) {
  const activeTab = ref(tabs[0]?.key ?? '')
  
  function switchTab(key: string) {
    activeTab.value = key
    const tab = tabs.find(t => t.key === key)
    if (tab?.lazyLoad) tab.lazyLoad()
  }

  return { activeTab, tabs, switchTab }
}
```

**Test file**: `src/__tests__/useTabNavigation.test.ts`
- switches tabs
- calls lazyLoader on first visit
- does not call lazyLoader on subsequent visits

### 4. `ProjectDetail.vue` Refactoring

Replace inline logic with composable calls:

```vue
<script setup lang="ts">
import { useGitHub } from '@/composables/useGitHub'
import { useUsage } from '@/composables/useUsage'
import { useMemory } from '@/composables/useMemory'
import { useTabNavigation } from '@/composables/useTabNavigation'

const projectId = computed(() => route.params.id as string)

const github = useGitHub(projectId)
const usage = useUsage(projectId)
const memory = useMemory(projectId)
const { activeTab, tabs, switchTab } = useTabNavigation([...])

// On mount, trigger lazy loads for first tab
onMounted(() => {
  const firstTab = tabs.find(t => t.key === activeTab.value)
  firstTab?.lazyLoad?.()
})
</script>
```

The template remains unchanged — only the script setup block changes.

## Alternatives Considered

| Approach | Pros | Cons |
|----------|------|------|
| Test views directly | No refactoring needed | Hard to test, tests Vue not logic, brittle |
| Extract composables + test composables | Clean, testable, reusable | More files, refactoring effort |
| Add Cypress E2E instead | Tests real user flows | Slower, flakier, doesn't catch unit bugs |

**Selected: Extract composables + test composables.** Best balance of test quality and maintainability.

## Risks

1. **Breaking `ProjectDetail.vue`** during extraction — mitigate by keeping composable APIs identical to current variable/function names
2. **Composable tests mock too much** — keep mocks minimal, test real reactive behavior
3. **Scope creep** — stick to ProjectDetail.vue only, don't refactor other large views

## File-Level Impact Matrix

| File | Action | Type |
|------|--------|------|
| `src/utils/diff.ts` | No change | Existing |
| `src/__tests__/diff.test.ts` | **Create** | Unit test |
| `src/__tests__/api-computeNodes.test.ts` | **Create** | Contract test |
| `src/__tests__/api-credentials.test.ts` | **Create** | Contract test |
| `src/__tests__/api-deployments.test.ts` | **Create** | Contract test |
| `src/__tests__/api-milestones.test.ts` | **Create** | Contract test |
| `src/__tests__/api-review.test.ts` | **Create** | Contract test |
| `src/composables/useGitHub.ts` | **Create** | New composable |
| `src/composables/useUsage.ts` | **Create** | New composable |
| `src/composables/useMemory.ts` | **Create** | New composable |
| `src/composables/useTabNavigation.ts` | **Create** | New composable |
| `src/__tests__/useGitHub.test.ts` | **Create** | Composable test |
| `src/__tests__/useUsage.test.ts` | **Create** | Composable test |
| `src/__tests__/useMemory.test.ts` | **Create** | Composable test |
| `src/__tests__/useTabNavigation.test.ts` | **Create** | Composable test |
| `src/views/ProjectDetail.vue` | **Modify** | Refactor to use composables |

Total: 15 new files, 1 modified file.
