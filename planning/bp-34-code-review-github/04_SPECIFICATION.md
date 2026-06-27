# bp-34: Code Review UI — GitHub PR Diff — Spec

**Target model**: 14B (TypeScript + JavaScript)
**Date**: 2026-06-27

## File Operations

### MODIFY: `backend/src/services/GitHubService.js`

**Add method** (after `listTicketPRs`):

```javascript
async getPRDiff(projectId, ticketId) {
  const repo = await this.getProjectRepo(projectId);
  if (!repo) throw new ValidationError('No repository connected to this project');

  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw new NotFoundError('Ticket not found');
  if (!ticket.prUrl) throw new ValidationError('No PR linked to this ticket');

  const prNumber = this._extractPRNumber(ticket.prUrl);
  const provider = new GitHubProvider(decrypt(repo.accessTokenEncrypted));
  return provider.getDiff(repo, prNumber);
}

_extractPRNumber(prUrl) {
  const match = prUrl.match(/\/pull\/(\d+)$/);
  if (!match) throw new ValidationError(`Invalid PR URL: ${prUrl}`);
  return parseInt(match[1], 10);
}
```

### MODIFY: `backend/src/providers/github.js` (GitHubProvider)

**Add method** to the provider class:

```javascript
async getDiff(repo, prNumber) {
  const { data } = await this.octokit.rest.pulls.listFiles({
    owner: repo.owner,
    repo: repo.repoName,
    pull_number: prNumber,
  });
  return {
    files: data.map(f => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      changes: f.changes,
      patch: f.patch || '',
      contentsUrl: f.contents_url,
    })),
    prNumber,
  };
}
```

If the provider does not use Octokit, use raw fetch:
```javascript
async getDiff(repo, prNumber) {
  const url = `https://api.github.com/repos/${repo.owner}/${repo.repoName}/pulls/${prNumber}/files`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github.v3+json' } });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const data = await res.json();
  return { files: data.map(f => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: f.patch || '' })), prNumber };
}
```

### MODIFY: `backend/src/api/tickets.js`

**Add require** at top:
```javascript
const GitHubService = require('../../services/GitHubService');
```

**Add route** before `module.exports`:
```javascript
router.get('/:ticketId/review/diff', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const ticket = await Ticket.findById(req.params.ticketId);
    if (!ticket) return res.status(404).json({ success: false, error: { message: 'Ticket not found' } });
    const diff = await GitHubService.getPRDiff(ticket.projectId, req.params.ticketId);
    res.json({ success: true, data: diff });
  } catch (err) {
    if (err instanceof ValidationError || err instanceof NotFoundError) {
      return res.status(400).json({ success: false, error: { message: err.message } });
    }
    next(err);
  }
});
```

### MODIFY: `backend/src/validators/tickets.js`

Replace `commentSchema`:
```javascript
const commentSchema = Joi.object({
  content: Joi.string().min(1).max(5000).required().messages({
    'string.empty': 'Comment content is required',
    'string.min': 'Comment content must be at least 1 character',
    'string.max': 'Comment content must not exceed 5000 characters',
    'any.required': 'Comment content is required',
  }),
  file_path: Joi.string().max(512).optional(),
  line_number: Joi.number().integer().min(1).optional(),
});
```

### CREATE: `frontend/src/components/DiffViewer.vue`

```vue
<script setup lang="ts">
import { ref, watch, computed, onMounted, nextTick } from 'vue'
import { Diff, Diff2Html } from 'diff2html'
import 'diff2html/bundles/css/diff2html.min.css'

interface DiffFile {
  filename: string
  status: string
  patch: string
  additions?: number
  deletions?: number
}

interface Comment {
  id: string
  filePath: string
  lineNumber: number
  content: string
  author: string
}

const props = withDefaults(defineProps<{
  files: DiffFile[]
  comments?: Comment[]
  viewMode?: 'split' | 'unified'
}>(), {
  comments: () => [],
  viewMode: 'split',
})

const emit = defineEmits<{
  'line-click': [file: string, line: number]
  'file-expand': [file: string]
}>()

const internalViewMode = ref(props.viewMode)
const collapsedFiles = ref<Set<string>>(new Set())
const diffContainers = ref<Map<string, HTMLElement>>(new Map())

const commentsByFile = computed(() => {
  const map: Record<string, Comment[]> = {}
  for (const c of props.comments) {
    if (!map[c.filePath]) map[c.filePath] = []
    map[c.filePath].push(c)
  }
  return map
})

function toggleFile(filename: string) {
  if (collapsedFiles.value.has(filename)) {
    collapsedFiles.value.delete(filename)
  } else {
    collapsedFiles.value.add(filename)
  }
}

function isCollapsed(filename: string) {
  return collapsedFiles.value.has(filename)
}

function collapseAll() {
  for (const f of props.files) collapsedFiles.value.add(f.filename)
}

function expandAll() {
  collapsedFiles.value.clear()
}

function fileIcon(status: string) {
  if (status === 'added') return 'A'
  if (status === 'deleted') return 'D'
  if (status === 'modified') return 'M'
  if (status === 'renamed') return 'R'
  return '?'
}

function onLineClick(filename: string, lineNumber: number) {
  emit('line-click', filename, lineNumber)
}

function renderDiff(filename: string, patch: string, el: HTMLElement | null) {
  if (!el || !patch) return
  const output = Diff2Html.html(patch, {
    drawFileList: false,
    matching: 'lines',
    outputFormat: internalViewMode.value,
    highlight: true,
  })
  el.innerHTML = output
  el.querySelectorAll('.d2h-code-line').forEach(lineEl => {
    const lineNum = lineEl.getAttribute('data-line-number')
    if (lineNum) {
      lineEl.addEventListener('click', () => onLineClick(filename, parseInt(lineNum, 10)))
      lineEl.style.cursor = 'pointer'
    }
  })
}

watch(internalViewMode, () => {
  for (const f of props.files) {
    const el = diffContainers.value.get(f.filename)
    if (el) renderDiff(f.filename, f.patch, el)
  }
})
</script>

<template>
  <div class="diff-viewer">
    <div class="diff-controls flex gap-2 mb-2 items-center">
      <label class="text-sm"><input type="radio" v-model="internalViewMode" value="split" /> Split</label>
      <label class="text-sm"><input type="radio" v-model="internalViewMode" value="unified" /> Unified</label>
      <button @click="collapseAll" class="text-xs px-2 py-1 border rounded">Collapse All</button>
      <button @click="expandAll" class="text-xs px-2 py-1 border rounded">Expand All</button>
    </div>
    <div v-for="file in files" :key="file.filename" class="diff-file border rounded mb-2">
      <div class="file-header flex items-center gap-2 px-3 py-1 bg-gray-100 cursor-pointer" @click="toggleFile(file.filename)">
        <span class="file-icon font-bold text-sm">{{ fileIcon(file.status) }}</span>
        <span class="file-name text-sm font-mono flex-1">{{ file.filename }}</span>
        <span class="file-stats text-xs" v-if="file.additions !== undefined">
          <span class="text-green-600">+{{ file.additions }}</span>
          <span class="text-red-600 ml-1">-{{ file.deletions }}</span>
        </span>
      </div>
      <div v-show="!isCollapsed(file.filename)" :ref="(el: any) => { if (el) diffContainers.set(file.filename, el as HTMLElement) }" class="diff-content">
      </div>
      <div v-if="commentsByFile[file.filename] && !isCollapsed(file.filename)" class="file-comments px-3 py-1 border-t bg-yellow-50">
        <div v-for="comment in commentsByFile[file.filename]" :key="comment.id" class="comment text-xs py-1">
          <span class="font-semibold">{{ comment.author }}</span>
          <span class="text-gray-500"> on line {{ comment.lineNumber }}:</span>
          <span class="ml-1">{{ comment.content }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
```

### CREATE: `frontend/src/api/review.js`

```typescript
import { get, post } from './client'

export interface DiffFile {
  filename: string
  status: string
  patch: string
  additions?: number
  deletions?: number
}

export function getGithubDiff(ticketId: string): Promise<{ files: DiffFile[] }> {
  return get(`/api/v1/tickets/${ticketId}/review/diff`)
}

export function getComments(ticketId: string, type = 'review'): Promise<any[]> {
  return get(`/api/v1/tickets/${ticketId}/comments?type=${type}`)
}

export function postComment(ticketId: string, data: { content: string; file_path?: string; line_number?: number }): Promise<any> {
  return post(`/api/v1/tickets/${ticketId}/comments`, data)
}
```

### CREATE: `frontend/src/views/CodeReview.vue`

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getGithubDiff, getComments, postComment } from '../api/review'
import { post } from '../api/client'
import DiffViewer from '../components/DiffViewer.vue'
import type { DiffFile } from '../api/review'

const route = useRoute()
const router = useRouter()
const ticketId = route.params.ticketId as string
const projectId = route.params.projectId as string

const files = ref<DiffFile[]>([])
const comments = ref<any[]>([])
const loading = ref(true)
const error = ref('')
const approveLoading = ref(false)
const changesLoading = ref(false)
const selectedLine = ref<{ file: string; line: number } | null>(null)
const newComment = ref('')

async function loadDiff() {
  loading.value = true
  try {
    const diffData = await getGithubDiff(ticketId)
    files.value = diffData.files || []
  } catch (e: any) {
    error.value = e.message || 'Failed to load diff'
  } finally {
    loading.value = false
  }
}

async function loadComments() {
  try {
    comments.value = await getComments(ticketId)
  } catch { /* ignore */ }
}

function onLineClick(file: string, line: number) {
  selectedLine.value = { file, line }
  newComment.value = ''
}

async function submitComment() {
  if (!newComment.value.trim() || !selectedLine.value) return
  try {
    await postComment(ticketId, {
      content: newComment.value,
      file_path: selectedLine.value.file,
      line_number: selectedLine.value.line,
    })
    newComment.value = ''
    selectedLine.value = null
    await loadComments()
  } catch (e: any) {
    alert(e.message)
  }
}

async function approve() {
  approveLoading.value = true
  try {
    await post(`/api/v1/tickets/${ticketId}/phases/transition`, {
      toPhase: 'human_approval',
      metadata: { action: 'approved', source: 'github-review' },
    })
    router.push(`/projects/${projectId}/tickets/${ticketId}`)
  } catch (e: any) {
    alert(e.message)
  } finally {
    approveLoading.value = false
  }
}

async function requestChanges() {
  const reason = prompt('Describe what changes are needed:')
  if (!reason) return
  changesLoading.value = true
  try {
    await post(`/api/v1/tickets/${ticketId}`, {
      content: `Changes requested:\n\n${reason}`,
    })
    await post(`/api/v1/tickets/${ticketId}/phases/transition`, {
      toPhase: 'in_progress',
      metadata: { action: 'changes_requested', reason },
    })
    router.push(`/projects/${projectId}/tickets/${ticketId}`)
  } catch (e: any) {
    alert(e.message)
  } finally {
    changesLoading.value = false
  }
}

onMounted(() => {
  loadDiff()
  loadComments()
})
</script>

<template>
  <div class="code-review p-4">
    <div v-if="loading" class="text-center py-8 text-gray-500">Loading diff...</div>
    <div v-else-if="error" class="text-center py-8 text-red-500">{{ error }}</div>
    <div v-else-if="files.length === 0" class="text-center py-8 text-gray-500">No files to review</div>
    <template v-else>
      <div class="review-header flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold">Code Review · {{ files.length }} file{{ files.length > 1 ? 's' : '' }}</h2>
        <div class="flex gap-2">
          <button @click="requestChanges" :disabled="changesLoading" class="px-4 py-2 border rounded text-sm bg-orange-50 hover:bg-orange-100">
            {{ changesLoading ? 'Submitting...' : '← Request Changes' }}
          </button>
          <button @click="approve" :disabled="approveLoading" class="px-4 py-2 border rounded text-sm bg-green-50 hover:bg-green-100">
            {{ approveLoading ? 'Processing...' : '✓ Approve' }}
          </button>
        </div>
      </div>
      <DiffViewer :files="files" :comments="comments" @line-click="onLineClick" />
      <div v-if="selectedLine" class="comment-form mt-4 p-3 border rounded bg-gray-50">
        <div class="text-xs text-gray-500 mb-1">Comment on {{ selectedLine.file }}:{{ selectedLine.line }}</div>
        <textarea v-model="newComment" rows="2" class="w-full border rounded p-2 text-sm" placeholder="Write a comment..."></textarea>
        <div class="flex gap-2 mt-1">
          <button @click="submitComment" :disabled="!newComment.trim()" class="px-3 py-1 bg-blue-500 text-white rounded text-sm">Submit</button>
          <button @click="selectedLine = null" class="px-3 py-1 border rounded text-sm">Cancel</button>
        </div>
      </div>
    </template>
  </div>
</template>
```

### MODIFY: `frontend/src/router/index.ts`

Add import and route:
```typescript
const CodeReview = () => import('../views/CodeReview.vue')
```

Add route object (in the tickets child routes or main routes):
```typescript
{
  path: 'tickets/:ticketId/review',
  name: 'CodeReview',
  component: CodeReview,
  meta: { requiresAuth: true },
},
```

## Test Expectations

```
✓ GET /api/v1/tickets/:id/review/diff returns { files: [...] } with patches
✓ DiffViewer renders split and unified modes correctly
✓ Clicking a line number emits line-click event
✓ Posting a comment with file_path and line_number stores it in ticket_comments
✓ Approve transitions ticket to human_approval phase
✓ Request Changes transitions ticket to in_progress phase
```

## Edge Cases to Handle

1. **No PR linked** (pr_url is null): endpoint returns 400 with message "No PR linked to this ticket"
2. **PR not found on GitHub** (deleted): GitHubProvider throws, endpoint returns 400
3. **Empty diff** (PR has no files changed): returns `{ files: [] }`, frontend shows "No files to review"
4. **Very large patch** (>1MB): GitHub API paginates at 30 files per page. Use octokit pagination or loop with `?page=N`
5. **Comment on a line that no longer exists** (after force push): comment still displays but the line may not match current diff — show with a warning indicator
