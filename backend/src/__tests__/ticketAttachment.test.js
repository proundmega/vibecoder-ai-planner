const TicketAttachmentService = require('../services/TicketAttachmentService');
const fs = require('fs');

jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
  },
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

describe('TicketAttachmentService', () => {
  const { pool } = require('../db');
  const mockFs = require('fs');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('upload', () => {
    it('should save file and create database record', async () => {
      pool.query.mockResolvedValue({
        rows: [{ id: 1, filename: 'test.txt', content_type: 'text/plain', size_bytes: 100, stored_path: '/uploads/test.txt' }],
      });

      const file = { originalname: 'test.txt', mimetype: 'text/plain', size: 100, path: '/uploads/test.txt' };
      const result = await TicketAttachmentService.upload('ticket-1', file, 'user-1');

      expect(pool.query).toHaveBeenCalled();
      expect(result.filename).toBe('test.txt');
    });
  });

  describe('list', () => {
    it('should return all attachments for a ticket', async () => {
      pool.query.mockResolvedValue({
        rows: [
          { id: 1, filename: 'test.txt', content_type: 'text/plain', size_bytes: 100, stored_path: '/uploads/test.txt', uploaded_by_name: 'User', created_at: '2026-01-01' },
        ],
      });

      const result = await TicketAttachmentService.list('ticket-1', 'user-1');
      expect(result).toHaveLength(1);
      expect(result[0].filename).toBe('test.txt');
    });

    it('should return empty array when no attachments', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const result = await TicketAttachmentService.list('ticket-1', 'user-1');
      expect(result).toEqual([]);
    });
  });

  describe('get', () => {
    it('should return attachment metadata', async () => {
      pool.query.mockResolvedValue({
        rows: [{ id: 1, filename: 'test.txt', content_type: 'text/plain', size_bytes: 100, stored_path: '/uploads/test.txt' }],
      });

      const result = await TicketAttachmentService.get(1, 'ticket-1', 'user-1');
      expect(result.id).toBe(1);
      expect(result.filename).toBe('test.txt');
    });

    it('should return null for non-existent attachment', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const result = await TicketAttachmentService.get(999, 'ticket-1', 'user-1');
      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should remove file from disk and database', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1, filename: 'test.txt', stored_path: 'uploads/tickets/1/test.txt' }] })
        .mockResolvedValueOnce({ rows: [1] });
      
      mockFs.existsSync.mockReturnValue(true);

      const result = await TicketAttachmentService.delete(1, 'ticket-1', 'user-1');

      expect(mockFs.existsSync).toHaveBeenCalled();
      expect(mockFs.unlinkSync).toHaveBeenCalled();
      expect(pool.query).toHaveBeenCalledWith(
        'DELETE FROM ticket_attachments WHERE id = $1 AND ticket_id = $2',
        [1, 'ticket-1']
      );
      expect(result).toBe(true);
    });

    it('should handle missing file on disk', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1, filename: 'test.txt', stored_path: 'uploads/tickets/1/test.txt' }] })
        .mockResolvedValueOnce({ rows: [1] });
      
      mockFs.existsSync.mockReturnValue(false);

      const result = await TicketAttachmentService.delete(1, 'ticket-1', 'user-1');
      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
      expect(result).toBe(true);
    });
  });
});
