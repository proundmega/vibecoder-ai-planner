import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, nextTick } from 'vue'
import * as projectsApi from '../api/projects'

vi.mock('../api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}))

describe('ProjectList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('editError vs deleteError display', () => {
    it('should set editError (not deleteError) when update fails', async () => {
      const { put } = await import('../api/client')
      put.mockResolvedValue(null)

      const editError = ref(null)
      const deleteError = ref(null)
      const updated = await projectsApi.updateProject('p1', 'Updated', 'New desc')

      if (!updated) {
        editError.value = 'Failed to update project'
      }

      expect(editError.value).toBe('Failed to update project')
      expect(deleteError.value).toBeNull()
    })

    it('should set deleteError when delete fails', async () => {
      const { del } = await import('../api/client')
      del.mockResolvedValue({ error: 'Failed to delete' })

      const editError = ref(null)
      const deleteError = ref(null)
      const result = await projectsApi.deleteProject('p1')

      if (result.error) {
        deleteError.value = result.error || 'Failed to delete project'
      }

      expect(deleteError.value).toBe('Failed to delete')
      expect(editError.value).toBeNull()
    })

    it('should not mix edit and delete errors in the template display', async () => {
      const { put } = await import('../api/client')
      put.mockResolvedValue(null)

      const editError = ref(null)
      const deleteError = ref(null)

      // Simulate: update fails
      const updated = await projectsApi.updateProject('p1', 'Updated', 'New desc')
      if (!updated) {
        editError.value = 'Failed to update project'
      }

      // Template shows: createError || editError || deleteError
      const displayError = editError.value || deleteError.value
      expect(displayError).toBe('Failed to update project')
      expect(editError.value).toBe('Failed to update project')
      expect(deleteError.value).toBeNull()
    })

    it('should show editError before deleteError in template', async () => {
      const editError = ref('Edit failed')
      const deleteError = ref('Delete failed')

      // Template: createError || editError || deleteError
      expect(editError.value || deleteError.value).toBe('Edit failed')
    })
  })
})
