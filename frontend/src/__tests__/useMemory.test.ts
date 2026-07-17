import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useMemory } from '@/composables/useMemory'

const mockGetProjectMemory = vi.fn()
const mockSearchMemory = vi.fn()
const mockAddMemory = vi.fn()
const mockUpdateMemory = vi.fn()
const mockDeleteMemory = vi.fn()

vi.mock('@/api/memory', () => ({
  getProjectMemory: (...args: unknown[]) => mockGetProjectMemory(...args),
  searchMemory: (...args: unknown[]) => mockSearchMemory(...args),
  addMemory: (...args: unknown[]) => mockAddMemory(...args),
  updateMemory: (...args: unknown[]) => mockUpdateMemory(...args),
  deleteMemory: (...args: unknown[]) => mockDeleteMemory(...args),
}))

describe('useMemory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initializes with default values', () => {
    const memory = useMemory(1)
    expect(memory.memories.value).toEqual([])
    expect(memory.memoryLoading.value).toBe(false)
    expect(memory.memoryError.value).toBeNull()
    expect(memory.loaded.value).toBe(false)
  })

  it('load sets memories', async () => {
    const memory = useMemory(1)
    const mockMemories = [
      { id: '1', content: 'test', created_at: '2026-01-01', created_by_name: 'alice' },
    ]
    mockGetProjectMemory.mockResolvedValue(mockMemories)

    await memory.load()
    expect(memory.memoryLoading.value).toBe(false)
    expect(memory.memories.value).toEqual(mockMemories)
    expect(memory.loaded.value).toBe(true)
    expect(memory.memoryError.value).toBeNull()
  })

  it('load sets error on failure', async () => {
    const memory = useMemory(1)
    mockGetProjectMemory.mockRejectedValue(new Error('fail'))

    await memory.load()
    expect(memory.memoryLoading.value).toBe(false)
    expect(memory.memoryError.value).toBe('Failed to load memories')
  })

  it('handleSearch calls searchMemory', async () => {
    const memory = useMemory(1)
    const mockResults = [{ id: '1', content: 'search result' }]
    mockSearchMemory.mockResolvedValue(mockResults)
    memory.searchQuery.value = 'test'

    await memory.handleSearch()
    expect(memory.isSearching.value).toBe(false)
    expect(memory.searchResults.value).toEqual(mockResults)
    expect(memory.memoryError.value).toBeNull()
  })

  it('clearSearch resets state', () => {
    const memory = useMemory(1)
    memory.searchQuery.value = 'test'
    memory.searchResults.value = [{ id: '1', project_id: '1', agent_id: null, content: 'test', metadata: {}, created_at: '2026-01-01', updated_at: '2026-01-01' }]
    memory.memoryError.value = 'error'

    memory.clearSearch()
    expect(memory.searchQuery.value).toBe('')
    expect(memory.searchResults.value).toEqual([])
    expect(memory.memoryError.value).toBeNull()
  })

  it('handleAdd calls addMemory and reloads', async () => {
    const memory = useMemory(1)
    mockAddMemory.mockResolvedValue(undefined)
    mockGetProjectMemory.mockResolvedValue([])
    memory.editMemoryContent.value = 'new memory'

    await memory.handleAdd()
    expect(mockAddMemory).toHaveBeenCalledWith('1', 'new memory', {})
    expect(memory.showAddMemory.value).toBe(false)
    expect(memory.editMemoryContent.value).toBe('')
  })

  it('handleUpdate calls updateMemory and reloads', async () => {
    const memory = useMemory(1)
    mockUpdateMemory.mockResolvedValue(undefined)
    mockGetProjectMemory.mockResolvedValue([])
    memory.editingMemory.value = { id: '1', project_id: '1', agent_id: null, content: 'old', metadata: {}, created_at: '2026-01-01', updated_at: '2026-01-01' }
    memory.editMemoryContent.value = 'updated'

    await memory.handleUpdate()
    expect(mockUpdateMemory).toHaveBeenCalledWith('1', 'updated')
    expect(memory.editingMemory.value).toBeNull()
  })

  it('handleDelete calls deleteMemory and reloads', async () => {
    const memory = useMemory(1)
    mockDeleteMemory.mockResolvedValue(undefined)
    mockGetProjectMemory.mockResolvedValue([])

    await memory.handleDelete('1')
    expect(mockDeleteMemory).toHaveBeenCalledWith('1')
    expect(memory.memoryDeleting.value).toBeNull()
  })
})
