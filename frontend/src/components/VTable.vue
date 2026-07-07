<template>
  <div class="v-table" :class="{ 'v-table--loading': loading, 'v-table--striped': striped }">
    <table>
      <thead v-if="columns.length > 0">
        <tr>
          <th
            v-for="col in columns"
            :key="col.key"
            :class="{ 'sortable': col.sortable }"
            @click="col.sortable ? emit('sort', col.key, col.direction === 'asc' ? 'desc' : 'asc') : null"
          >
            <span>{{ col.label }}</span>
            <span v-if="col.sortable" class="sort-icon">
              <span v-if="sortColumn === col.key && col.direction === 'asc'">↑</span>
              <span v-else-if="sortColumn === col.key && col.direction === 'desc'">↓</span>
              <span v-else>↕</span>
            </span>
          </th>
        </tr>
      </thead>
      <tbody v-if="!loading && rows.length > 0">
        <tr v-for="(row, rowIndex) in rows" :key="rowIndex">
          <td v-for="col in columns" :key="col.key">
            <slot
              v-if="col.key === '$actions'"
              name="actions"
              :row="row"
            />
            <slot
              v-else-if="col.slot"
              :name="col.slot"
              :row="row"
              :value="row[col.key]"
            />
            <template v-else>
              {{ row[col.key] }}
            </template>
          </td>
        </tr>
      </tbody>
      <tbody v-else-if="loading">
        <tr v-for="i in skeletonRows" :key="i">
          <td v-for="col in columns" :key="col.key" class="skeleton-cell">
            <div class="skeleton-line" />
          </td>
        </tr>
      </tbody>
      <tbody v-else>
        <tr>
          <td :colspan="columns.length" class="empty-cell">
            {{ emptyMessage || 'No data available' }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  columns: Array<{ key: string; label: string; sortable?: boolean; slot?: string; width?: string; direction?: 'asc' | 'desc' }>
  rows: Record<string, any>[]
  loading?: boolean
  emptyMessage?: string
  striped?: boolean
  skeletonRows?: number
  sortColumn?: string
}>(), {
  loading: false,
  emptyMessage: 'No data available',
  striped: true,
  skeletonRows: 5,
  sortColumn: ''
})

const emit = defineEmits<{
  sort: [key: string, direction: 'asc' | 'desc']
}>()
</script>

<style scoped>
.v-table {
  width: 100%;
  overflow-x: auto;
}

.v-table table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-base);
}

.v-table th {
  text-align: left;
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--color-bg-secondary);
  border-bottom: 2px solid var(--color-border);
  font-weight: 600;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
}

.v-table th.sortable {
  cursor: pointer;
  user-select: none;
}

.v-table th.sortable:hover {
  background: var(--color-bg-tertiary);
}

.sort-icon {
  margin-left: var(--spacing-xs);
  opacity: 0.5;
}

.v-table td {
  padding: var(--spacing-sm) var(--spacing-md);
  border-bottom: 1px solid var(--color-border-light);
  color: var(--color-text);
}

.v-table--striped tbody tr:nth-child(even) {
  background: var(--color-bg-secondary);
}

.v-table--loading tbody tr:hover {
  background: transparent;
}

.skeleton-cell {
  padding: var(--spacing-sm) var(--spacing-md);
}

.skeleton-line {
  height: 16px;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-sm);
  animation: pulse 1.5s ease-in-out infinite;
}

.empty-cell {
  text-align: center;
  padding: var(--spacing-xl);
  color: var(--color-text-secondary);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
</style>
