jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn().mockReturnValue({
      query: jest.fn(),
      release: jest.fn(),
    }),
  },
}));

const phaseService = require('../services/PhaseService');
const { NotFoundError, ValidationError } = require('../errors/HttpError');

describe('PhaseService', () => {
  const mockPool = require('../db').pool;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ALLOWED_TRANSITIONS', () => {
    test('should have all expected phases', () => {
      const expectedPhases = [
        'draft', 'planning', 'plan_approved', 'assigned',
        'in_progress', 'blocked', 'review', 'human_approval', 'done', 'deployed'
      ];
      for (const phase of expectedPhases) {
        expect(phaseService.ALLOWED_TRANSITIONS).toHaveProperty(phase);
      }
    });

    test('draft should only allow planning', () => {
      expect(phaseService.ALLOWED_TRANSITIONS.draft).toEqual(['planning']);
    });

    test('done should allow deployed and in_progress', () => {
      expect(phaseService.ALLOWED_TRANSITIONS.done).toEqual(['deployed', 'in_progress']);
    });

    test('deployed should only allow done', () => {
      expect(phaseService.ALLOWED_TRANSITIONS.deployed).toEqual(['done']);
    });
  });

  describe('getCurrentPhase', () => {
    test('should return current phase for existing ticket', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ phase: 'in_progress' }]
      });

      const phase = await phaseService.getCurrentPhase('ticket-123');
      expect(phase).toBe('in_progress');
      expect(mockPool.query).toHaveBeenCalledWith(
        'SELECT phase FROM tickets WHERE id = $1 AND deleted_at IS NULL',
        ['ticket-123']
      );
    });

    test('should default to draft when phase is null', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ phase: null }]
      });

      const phase = await phaseService.getCurrentPhase('ticket-456');
      expect(phase).toBe('draft');
    });

    test('should throw NotFoundError for non-existent ticket', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(phaseService.getCurrentPhase('nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('getAllowedNextPhases', () => {
    test('should return allowed next phases for current phase', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ phase: 'draft' }]
      });

      const allowed = await phaseService.getAllowedNextPhases('ticket-123');
      expect(allowed).toEqual(['planning']);
    });

    test('should return allowed next phases for in_progress', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ phase: 'in_progress' }]
      });

      const allowed = await phaseService.getAllowedNextPhases('ticket-123');
      expect(allowed).toContain('review');
      expect(allowed).toContain('blocked');
      expect(allowed).toContain('backlog');
    });

    test('should throw NotFoundError for non-existent ticket', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(phaseService.getAllowedNextPhases('nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('getPhaseHistory', () => {
    test('should return phase history for ticket', async () => {
      const mockHistory = [
        { from_phase: null, to_phase: 'draft', actor_type: 'system', created_at: new Date() },
        { from_phase: 'draft', to_phase: 'planning', actor_type: 'human', created_at: new Date() },
        { from_phase: 'planning', to_phase: 'plan_approved', actor_type: 'human', created_at: new Date() },
      ];
      mockPool.query.mockResolvedValueOnce({ rows: mockHistory });

      const history = await phaseService.getPhaseHistory('ticket-123');
      expect(history).toHaveLength(3);
      expect(history[0].to_phase).toBe('draft');
      expect(history[2].to_phase).toBe('plan_approved');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM ticket_phases'),
        ['ticket-123']
      );
    });

    test('should return empty array when no history exists', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const history = await phaseService.getPhaseHistory('ticket-999');
      expect(history).toEqual([]);
    });
  });

  describe('transition', () => {
    test('should successfully transition from draft to planning', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({})  // BEGIN
          .mockResolvedValueOnce({ rows: [{ id: 'ticket-1', phase: 'draft' }] })
          .mockResolvedValueOnce({})  // UPDATE
          .mockResolvedValueOnce({})  // INSERT
          .mockResolvedValueOnce({}), // COMMIT
        release: jest.fn(),
      };
      mockPool.connect.mockReturnValue(mockClient);

      const result = await phaseService.transition('ticket-1', 'planning', 'human', 'user-1', { reason: 'starting planning' });

      expect(result).toEqual({
        ticketId: 'ticket-1',
        fromPhase: 'draft',
        toPhase: 'planning',
      });
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    test('should throw ValidationError for invalid transition', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({})  // BEGIN
          .mockResolvedValueOnce({ rows: [{ id: 'ticket-1', phase: 'draft' }] }),
        release: jest.fn(),
      };
      mockPool.connect.mockReturnValue(mockClient);

      await expect(
        phaseService.transition('ticket-1', 'review', 'human', 'user-1')
      ).rejects.toThrow(ValidationError);
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    test('should throw NotFoundError when ticket does not exist', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({})  // BEGIN
          .mockResolvedValueOnce({ rows: [] }),
        release: jest.fn(),
      };
      mockPool.connect.mockReturnValue(mockClient);

      await expect(
        phaseService.transition('nonexistent', 'planning', 'human', 'user-1')
      ).rejects.toThrow(NotFoundError);
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    test('should log transition with metadata', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({})  // BEGIN
          .mockResolvedValueOnce({ rows: [{ id: 'ticket-1', phase: 'in_progress' }] })
          .mockResolvedValueOnce({})  // UPDATE
          .mockResolvedValueOnce({})  // INSERT
          .mockResolvedValueOnce({}), // COMMIT
        release: jest.fn(),
      };
      mockPool.connect.mockReturnValue(mockClient);

      const metadata = { reason: 'code review requested', reviewer: 'admin-1' };
      await phaseService.transition('ticket-1', 'review', 'agent', 'agent-1', metadata);

      const insertCall = mockClient.query.mock.calls.find(call =>
        call[0].includes('INSERT INTO ticket_phases')
      );
      expect(insertCall).toBeDefined();
      expect(insertCall[1][4]).toBe('agent-1');
    });

    test('should handle blocked phase transition', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({})  // BEGIN
          .mockResolvedValueOnce({ rows: [{ id: 'ticket-1', phase: 'in_progress' }] })
          .mockResolvedValueOnce({})  // UPDATE
          .mockResolvedValueOnce({})  // INSERT
          .mockResolvedValueOnce({}), // COMMIT
        release: jest.fn(),
      };
      mockPool.connect.mockReturnValue(mockClient);

      const result = await phaseService.transition('ticket-1', 'blocked', 'agent', 'agent-1');
      expect(result.toPhase).toBe('blocked');
    });

    test('should handle rollback from deployed to done', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({})  // BEGIN
          .mockResolvedValueOnce({ rows: [{ id: 'ticket-1', phase: 'deployed' }] })
          .mockResolvedValueOnce({})  // UPDATE
          .mockResolvedValueOnce({})  // INSERT
          .mockResolvedValueOnce({}), // COMMIT
        release: jest.fn(),
      };
      mockPool.connect.mockReturnValue(mockClient);

      const result = await phaseService.transition('ticket-1', 'done', 'human', 'user-1');
      expect(result.toPhase).toBe('done');
    });

    test('should handle reopen from done to in_progress', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({})  // BEGIN
          .mockResolvedValueOnce({ rows: [{ id: 'ticket-1', phase: 'done' }] })
          .mockResolvedValueOnce({})  // UPDATE
          .mockResolvedValueOnce({})  // INSERT
          .mockResolvedValueOnce({}), // COMMIT
        release: jest.fn(),
      };
      mockPool.connect.mockReturnValue(mockClient);

      const result = await phaseService.transition('ticket-1', 'in_progress', 'human', 'user-1');
      expect(result.toPhase).toBe('in_progress');
    });
  });

  describe('getGateStatus', () => {
    test('should return gate status for planning_complete', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ planning_status: 'completed', template_schema: null }]
      });

      const status = await phaseService.getGateStatus('ticket-123', 'plan_approved');
      expect(status.gates.planning_complete).toBe(true);
      expect(status.allPassed).toBe(true);
    });

    test('should return failed gates when planning not complete', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ planning_status: 'not_started', template_schema: null }]
      });

      const status = await phaseService.getGateStatus('ticket-123', 'plan_approved');
      expect(status.gates.planning_complete).toBe(false);
      expect(status.failedGates).toContain('planning_complete');
      expect(status.allPassed).toBe(false);
    });

    test('should throw NotFoundError for non-existent ticket', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(phaseService.getGateStatus('nonexistent', 'plan_approved')).rejects.toThrow(NotFoundError);
    });
  });

  describe('isBacklogCompatible', () => {
    test('should return true for backlog-compatible phases', () => {
      expect(phaseService.isBacklogCompatible('draft')).toBe(true);
      expect(phaseService.isBacklogCompatible('planning')).toBe(true);
      expect(phaseService.isBacklogCompatible('plan_approved')).toBe(true);
      expect(phaseService.isBacklogCompatible('assigned')).toBe(true);
    });

    test('should return false for non-backlog-compatible phases', () => {
      expect(phaseService.isBacklogCompatible('in_progress')).toBe(false);
      expect(phaseService.isBacklogCompatible('review')).toBe(false);
      expect(phaseService.isBacklogCompatible('done')).toBe(false);
      expect(phaseService.isBacklogCompatible('deployed')).toBe(false);
    });
  });
});
