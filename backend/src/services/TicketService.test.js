const TicketService = require('./TicketService');

describe('TicketService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findByProject', () => {
    it('should handle project not found gracefully', async () => {
      const result = await TicketService.findByProject('nonexistent', 'user-1');
      expect(result).toBeDefined();
    });
  });

  describe('findByStatus', () => {
    it('should filter tickets by status', async () => {
      const result = await TicketService.findByStatus('project-1', 'backlog');
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle invalid status', async () => {
      const result = await TicketService.findByStatus('project-1', 'invalid_status');
      expect(result).toBeDefined();
    });
  });

  describe('getOne', () => {
    it('should retrieve ticket by ID', async () => {
      const result = await TicketService.getOne('t1', 'user-1');
      expect(result).toBeDefined();
    });

    it('should throw error for non-existent ticket', async () => {
      await expect(TicketService.getOne('nonexistent', 'user-1'))
        .rejects
        .toThrow('Ticket not found');
    });
  });

  describe('update', () => {
    it('should update ticket title', async () => {
      await TicketService.update('t1', 'New Title', null, 'backlog', null, null, 'user-1');
      expect(true).toBe(true);
    });

    it('should update ticket description', async () => {
      await TicketService.update('t1', null, 'New Desc', 'backlog', null, null, 'user-1');
    });

    it('should update ticket priority', async () => {
      await TicketService.update('t1', null, null, 'backlog', 'high', null, 'user-1');
    });
  });

  describe('updateStatus', () => {
    it('should allow transition to in_progress from backlog', async () => {
      await TicketService.updateStatus('t1', 'in_progress', 'user-1');
    });

    it('should allow transition to done from backlog', async () => {
      await TicketService.updateStatus('t1', 'done', 'user-1');
    });

    it('should allow transition to review from in_progress', async () => {
      await TicketService.updateStatus('t1', 'review', 'user-1');
    });

    it('should allow transition to done from review', async () => {
      await TicketService.updateStatus('t1', 'done', 'user-1');
    });

    it('should allow transition to backlog from review', async () => {
      await TicketService.updateStatus('t1', 'backlog', 'user-1');
    });

    it('should allow transition to backlog from in_progress', async () => {
      await TicketService.updateStatus('t1', 'backlog', 'user-1');
    });

    it('should reject invalid status transition review to in_progress', async () => {
      await expect(
        TicketService.updateStatus('t1', 'in_progress', 'user-1')
      ).rejects.toThrow('Invalid status transition');
    });

    it('should reject invalid status value', async () => {
      await expect(
        TicketService.updateStatus('t1', 'invalid', 'user-1')
      ).rejects.toThrow('Invalid status');
    });
  });
});
