const MessageService = require('../services/MessageService');
const { ValidationError, NotFoundError } = require('../errors/HttpError');

jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
  },
}));

jest.mock('../services/PermissionService', () => ({
  hasPermission: jest.fn(),
}));

describe('MessageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('postMessage', () => {
    test('should create a message and return it with user info', async () => {
      const mockRow = {
        id: 1,
        ticket_id: 100,
        user_id: 1,
        message_type: 'update',
        content: 'Agent picked up ticket',
        metadata: JSON.stringify({ agentId: 'agent-1' }),
        created_at: new Date(),
        user_name: 'Test Agent',
        user_email: 'agent@test.com',
      };

      require('../db').pool.query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await MessageService.postMessage(100, 1, 'update', 'Agent picked up ticket', { agentId: 'agent-1' });

      expect(require('../db').pool.query).toHaveBeenCalledWith(
        expect.any(String),
        [100, 1, 'update', 'Agent picked up ticket', JSON.stringify({ agentId: 'agent-1' })]
      );

      expect(result).toEqual({
        id: 1,
        ticketId: 100,
        userId: 1,
        userName: 'Test Agent',
        userEmail: 'agent@test.com',
        messageType: 'update',
        content: 'Agent picked up ticket',
        metadata: { agentId: 'agent-1' },
        createdAt: expect.any(Date),
      });
    });

    test('should handle messages without metadata', async () => {
      const mockRow = {
        id: 2,
        ticket_id: 100,
        user_id: 1,
        message_type: 'status',
        content: 'Ticket status changed to in_progress',
        metadata: JSON.stringify({}),
        created_at: new Date(),
        user_name: 'Test User',
        user_email: 'user@test.com',
      };

      require('../db').pool.query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await MessageService.postMessage(100, 1, 'status', 'Ticket status changed to in_progress');

      expect(result.metadata).toEqual({});
    });
  });

  describe('getTicketMessages', () => {
    test('should return messages for a ticket sorted by created_at', async () => {
      const mockRows = [
        {
          id: 1,
          ticket_id: 100,
          user_id: 1,
          message_type: 'update',
          content: 'Message 1',
          metadata: JSON.stringify({}),
          created_at: new Date('2024-01-01'),
          user_name: 'User 1',
          user_email: 'user1@test.com',
        },
        {
          id: 2,
          ticket_id: 100,
          user_id: 2,
          message_type: 'update',
          content: 'Message 2',
          metadata: JSON.stringify({}),
          created_at: new Date('2024-01-02'),
          user_name: 'User 2',
          user_email: 'user2@test.com',
        },
      ];

      require('../db').pool.query.mockResolvedValueOnce({ rows: mockRows });

      const result = await MessageService.getTicketMessages(100);

      expect(require('../db').pool.query).toHaveBeenCalledWith(
        expect.any(String),
        [100, 50]
      );

      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('Message 1');
      expect(result[1].content).toBe('Message 2');
    });

    test('should respect limit parameter', async () => {
      const mockRows = [
        {
          id: 1,
          ticket_id: 100,
          user_id: 1,
          message_type: 'update',
          content: 'Message 1',
          metadata: JSON.stringify({}),
          created_at: new Date(),
          user_name: 'User 1',
          user_email: 'user1@test.com',
        },
      ];

      require('../db').pool.query.mockResolvedValueOnce({ rows: mockRows });

      await MessageService.getTicketMessages(100, 10);

      expect(require('../db').pool.query).toHaveBeenCalledWith(
        expect.any(String),
        [100, 10]
      );
    });
  });

  describe('getUnreadMessages', () => {
    test('should return messages created after timestamp for a user', async () => {
      const mockRows = [
        {
          id: 1,
          ticket_id: 100,
          user_id: 2,
          message_type: 'update',
          content: 'New message',
          metadata: JSON.stringify({}),
          created_at: new Date(),
          user_name: 'User 2',
          user_email: 'user2@test.com',
        },
      ];

      require('../db').pool.query.mockResolvedValueOnce({ rows: mockRows });

      const result = await MessageService.getUnreadMessages(1, new Date('2024-01-01'));

      expect(require('../db').pool.query).toHaveBeenCalledWith(
        expect.any(String),
        [new Date('2024-01-01'), 1]
      );

      expect(result).toHaveLength(1);
      expect(result[0].userId).toBe(2);
    });

    test('should exclude messages from the requesting user', async () => {
      const mockRows = [];

      require('../db').pool.query.mockResolvedValueOnce({ rows: mockRows });

      const result = await MessageService.getUnreadMessages(1, new Date('2024-01-01'));

      expect(result).toHaveLength(0);
    });
  });
});
