const TicketService = require('./TicketService');

describe('TicketService', () => {
  describe('updateStatus', () => {
    it.skip('should allow transition from backlog to in_progress', async () => {
      const result = await TicketService.updateStatus('t1', 'in_progress', 'user-1');
      expect(result).toBeDefined();
    });
  });
});
