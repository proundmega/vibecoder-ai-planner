<script setup>
import { ref, computed, nextTick, watch } from 'vue'
import { html, parse } from 'diff2html'

const props = defineProps({
  files: { type: Array, default: () => [] },
  comments: { type: Array, default: () => [] },
  viewMode: { type: String, default: 'split' },
})

const emit = defineEmits(['line-click', 'file-expand'])

const internalViewMode = ref(props.viewMode)
const collapsedFiles = ref(new Set())
const diffContainers = ref(new Map())
const selectedLines = ref(new Map())

const commentsByFile = computed(() => {
  const map = {}
  for (const c of props.comments) {
    const key = c.file_path || 'global'
    if (!map[key]) map[key] = []
    map[key].push(c)
  }
  return map
})

function toggleFile(filename) {
  if (collapsedFiles.value.has(filename)) {
    collapsedFiles.value.delete(filename)
  } else {
    collapsedFiles.value.add(filename)
  }
  collapsedFiles.value = new Set(collapsedFiles.value)
  emit('file-expand', filename)
}

function isCollapsed(filename) {
  return collapsedFiles.value.has(filename)
}

function collapseAll() {
  for (const f of props.files) collapsedFiles.value.add(f.filename)
  collapsedFiles.value = new Set(collapsedFiles.value)
}

function expandAll() {
  collapsedFiles.value.clear()
  collapsedFiles.value = new Set(collapsedFiles.value)
}

function fileIcon(status) {
  if (status === 'added') return 'A'
  if (status === 'deleted') return 'D'
  if (status === 'modified') return 'M'
  if (status === 'renamed') return 'R'
  return '?'
}

function onLineClick(filename, lineNumber) {
  emit('line-click', filename, lineNumber)
}

function renderDiff(filename, patch, el) {
  if (!el || !patch) return
  const parsedDiff = parse(patch)
  const output = html(parsedDiff, {
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

function getCommentsForLine(filename, lineNum) {
  const fileComments = commentsByFile.value[filename] || []
  return fileComments.filter(c => c.line_number === lineNum)
}

function hasComments(filename) {
  const fileComments = commentsByFile.value[filename] || []
  return fileComments.length > 0
}

function getLineCommentsCount(filename) {
  const fileComments = commentsByFile.value[filename] || []
  const uniqueLines = new Set(fileComments.map(c => c.line_number))
  return uniqueLines.size
}
</script>

<template>
  <div class="diff-viewer">
    <div class="diff-controls">
      <label class="view-toggle">
        <input type="radio" v-model="internalViewMode" value="split" />
        Split
      </label>
      <label class="view-toggle">
        <input type="radio" v-model="internalViewMode" value="unified" />
        Unified
      </label>
      <button @click="collapseAll" class="btn-sm">Collapse All</button>
      <button @click="expandAll" class="btn-sm">Expand All</button>
    </div>

    <div v-for="file in files" :key="file.filename" class="diff-file">
      <div class="file-header" @click="toggleFile(file.filename)">
        <span class="file-icon">{{ fileIcon(file.status) }}</span>
        <span class="file-name">{{ file.filename }}</span>
        <span class="file-stats">
          <span v-if="file.additions !== undefined" class="additions">+{{ file.additions }}</span>
          <span v-if="file.deletions !== undefined" class="deletions">-{{ file.deletions }}</span>
        </span>
        <span v-if="hasComments(file.filename)" class="comment-badge">
          {{ getLineCommentsCount(file.filename) }}
        </span>
      </div>

      <div v-show="!isCollapsed(file.filename)" class="diff-content-wrapper">
        <div :ref="(el) => { if (el) diffContainers.set(file.filename, el) }" class="diff-content"></div>
      </div>

      <div v-if="hasComments(file.filename) && !isCollapsed(file.filename)" class="file-comments">
        <h4 class="comments-title">Comments on {{ file.filename }}</h4>
        <div v-for="comment in commentsByFile[file.filename]" :key="comment.id" class="comment">
          <div class="comment-header">
            <span class="comment-author">{{ comment.author }}</span>
            <span v-if="comment.line_number" class="comment-line">line {{ comment.line_number }}</span>
            <span class="comment-time">{{ comment.created_at ? new Date(comment.created_at).toLocaleString() : '' }}</span>
          </div>
          <div class="comment-body">{{ comment.content }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.diff-viewer {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
}

.diff-controls {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 12px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px 8px 0 0;
}

.view-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: #374151;
  cursor: pointer;
}

.btn-sm {
  padding: 4px 12px;
  font-size: 12px;
  border: 1px solid #d1d5db;
  background: white;
  border-radius: 4px;
  cursor: pointer;
}

.btn-sm:hover {
  background: #f3f4f6;
}

.diff-file {
  border: 1px solid #e5e7eb;
  margin-top: 8px;
  border-radius: 8px;
  overflow: hidden;
}

.file-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: #f9fafb;
  cursor: pointer;
  border-bottom: 1px solid #e5e7eb;
}

.file-header:hover {
  background: #f3f4f6;
}

.file-icon {
  font-weight: 700;
  font-size: 12px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: #e5e7eb;
  color: #374151;
}

.file-name {
  flex: 1;
  font-size: 13px;
  font-family: monospace;
  color: #1f2937;
}

.file-stats {
  font-size: 12px;
  font-weight: 600;
}

.additions {
  color: #16a34a;
}

.deletions {
  color: #dc2626;
  margin-left: 8px;
}

.comment-badge {
  background: #3b82f6;
  color: white;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 10px;
  font-weight: 600;
}

.diff-content-wrapper {
  overflow-x: auto;
}

.diff-content {
  padding: 12px;
  font-size: 13px;
  line-height: 1.5;
  background: white;
}

.file-comments {
  padding: 12px;
  background: #fefce8;
  border-top: 1px solid #fde047;
}

.comments-title {
  margin: 0 0 8px 0;
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}

.comment {
  margin-bottom: 8px;
  padding: 8px;
  background: white;
  border-radius: 6px;
  border: 1px solid #fde047;
}

.comment:last-child {
  margin-bottom: 0;
}

.comment-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 12px;
}

.comment-author {
  font-weight: 600;
  color: #1f2937;
}

.comment-line {
  color: #6b7280;
  font-size: 11px;
}

.comment-time {
  margin-left: auto;
  color: #9ca3af;
  font-size: 11px;
}

.comment-body {
  font-size: 13px;
  color: #374151;
  line-height: 1.4;
}
</style>
