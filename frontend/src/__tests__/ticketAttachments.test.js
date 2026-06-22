import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as ticketAttachments from '../api/ticketAttachments'

vi.mock('../api/client', () => ({
  get: vi.fn(),
  del: vi.fn(),
  postMultipart: vi.fn(),
}))

describe('ticketAttachments API', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('fetchAttachments', () => {
    it('sends GET request to correct URL', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue([{ id: 'att-1', filename: 'screenshot.png' }])

      const result = await ticketAttachments.fetchAttachments('ticket-1')

      expect(get).toHaveBeenCalledWith('/api/v1/tickets/ticket-1/attachments')
      expect(result).toEqual([{ id: 'att-1', filename: 'screenshot.png' }])
    })
  })

  describe('uploadAttachment', () => {
    it('creates FormData and calls postMultipart with correct URL', async () => {
      const { postMultipart } = await import('../api/client')
      postMultipart.mockResolvedValue({ id: 'att-1', filename: 'file.txt' })

      const mockFile = new File(['content'], 'file.txt', { type: 'text/plain' })
      const result = await ticketAttachments.uploadAttachment('ticket-1', mockFile)

      expect(postMultipart).toHaveBeenCalledWith('/api/v1/tickets/ticket-1/attachments', expect.any(FormData))
      expect(result).toEqual({ id: 'att-1', filename: 'file.txt' })
    })
  })

  describe('deleteAttachment', () => {
    it('sends DELETE request to correct URL', async () => {
      const { del } = await import('../api/client')
      del.mockResolvedValue({ deleted: true })

      const result = await ticketAttachments.deleteAttachment('ticket-1', 'att-1')

      expect(del).toHaveBeenCalledWith('/api/v1/tickets/ticket-1/attachments/att-1')
      expect(result).toEqual({ deleted: true })
    })
  })
})
