import { ref } from 'vue'
import { getProjectMemory, searchMemory, addMemory, updateMemory, deleteMemory, type Memory } from '@/api/memory'

export function useMemory(projectId: string | number) {
  const memories = ref<Memory[]>([])
  const memoryLoading = ref(false)
  const memoryError = ref<string | null>(null)
  const showAddMemory = ref(false)
  const searchQuery = ref('')
  const searchResults = ref<Memory[]>([])
  const isSearching = ref(false)
  const editingMemory = ref<Memory | null>(null)
  const editMemoryContent = ref('')
  const memorySaving = ref(false)
  const memoryDeleting = ref<string | null>(null)
  const loaded = ref(false)

  async function load() {
    memoryLoading.value = true
    memoryError.value = null
    try {
      memories.value = await getProjectMemory(String(projectId))
      loaded.value = true
    } catch (_err) {
      memoryError.value = 'Failed to load memories'
    } finally {
      memoryLoading.value = false
    }
  }

  async function handleSearch() {
    if (!searchQuery.value.trim()) {
      clearSearch()
      return
    }
    isSearching.value = true
    searchResults.value = []
    try {
      const result = await searchMemory(String(projectId), searchQuery.value)
      searchResults.value = result || []
    } catch (error: unknown) {
      const e = error as { message?: string }
      memoryError.value = e.message || 'Search failed'
    } finally {
      isSearching.value = false
    }
  }

  function clearSearch() {
    searchQuery.value = ''
    searchResults.value = []
    memoryError.value = null
  }

  async function handleAdd() {
    if (!editMemoryContent.value.trim()) return
    memorySaving.value = true
    memoryError.value = null
    try {
      await addMemory(String(projectId), editMemoryContent.value.trim(), {})
      showAddMemory.value = false
      editMemoryContent.value = ''
      await load()
    } catch (err: unknown) {
      const e = err as { message?: string }
      memoryError.value = e.message || 'Failed to add memory'
    } finally {
      memorySaving.value = false
    }
  }

  async function handleUpdate() {
    if (!editingMemory.value || !editMemoryContent.value.trim()) return
    memorySaving.value = true
    memoryError.value = null
    try {
      await updateMemory(editingMemory.value.id, editMemoryContent.value.trim())
      editingMemory.value = null
      editMemoryContent.value = ''
      await load()
    } catch (err: unknown) {
      const e = err as { message?: string }
      memoryError.value = e.message || 'Failed to update memory'
    } finally {
      memorySaving.value = false
    }
  }

  async function handleDelete(memoryId: string) {
    memoryDeleting.value = memoryId
    try {
      await deleteMemory(memoryId)
      await load()
    } catch (err: unknown) {
      const e = err as { message?: string }
      memoryError.value = e.message || 'Failed to delete memory'
    } finally {
      memoryDeleting.value = null
    }
  }

  return {
    memories, memoryLoading, memoryError, showAddMemory, searchQuery, searchResults,
    isSearching, editingMemory, editMemoryContent, memorySaving, memoryDeleting, loaded,
    load, handleSearch, clearSearch, handleAdd, handleUpdate, handleDelete,
  }
}
