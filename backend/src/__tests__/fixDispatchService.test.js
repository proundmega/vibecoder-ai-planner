jest.mock('../db', () => ({
  pool: { query: jest.fn() },
}));

jest.mock('../services/FixRequestService', () => ({
  preResolve: jest.fn(),
}));

const { pool } = require('../db');
const FixRequestService = require('../services/FixRequestService');
const FixDispatchService = require('../services/FixDispatchService');
const {
  FixDispatchService: FixDispatchServiceClass,
  resolveModeValue,
  feedbackFromMetadata,
} = require('../services/FixDispatchService');

describe('fg-32c2b fix dispatch', () => {
  const originalEnv = process.env.FIX_LOOP_MODE;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.FIX_LOOP_MODE;
  });

  afterAll(() => {
    if (originalEnv === undefined) delete process.env.FIX_LOOP_MODE;
    else process.env.FIX_LOOP_MODE = originalEnv;
  });

  describe('mode resolution', () => {
    test('defaults to off', () => {
      expect(resolveModeValue(null)).toBe('off');
      expect(resolveModeValue('')).toBe('off');
    });

    test('the project setting overrides the environment', () => {
      process.env.FIX_LOOP_MODE = 'auto';
      expect(resolveModeValue('manual')).toBe('manual');
      expect(resolveModeValue(null)).toBe('auto');
    });

    test('an invalid environment mode fails closed to off', () => {
      process.env.FIX_LOOP_MODE = 'sometimes';
      expect(resolveModeValue(null)).toBe('off');
    });

    test('an invalid project value falls back to the environment', () => {
      process.env.FIX_LOOP_MODE = 'manual';
      expect(resolveModeValue('bogus')).toBe('manual');
    });

  });

  describe('feedback normalisation', () => {
    test('accepts reason and feedback, preferring feedback', () => {
      expect(feedbackFromMetadata({ reason: ' needs work ' })).toBe('needs work');
      expect(feedbackFromMetadata({ reason: 'a', feedback: 'b' })).toBe('b');
      expect(feedbackFromMetadata({ feedback: '   ' })).toBeNull();
      expect(feedbackFromMetadata(null)).toBeNull();
      expect(feedbackFromMetadata('reason')).toBeNull();
      expect(feedbackFromMetadata(['reason'])).toBeNull();
    });
  });

  describe('assertCanCreate', () => {
    function dispatchRow(mode) {
      return { rows: [{ fix_loop_mode: mode }] };
    }

    test('refuses every source when the loop is off', async () => {
      pool.query.mockResolvedValueOnce(dispatchRow('off'));

      await expect(FixDispatchService.assertCanCreate(42, 'human'))
        .rejects.toThrow('Fix loop is disabled for this project');
      expect(pool.query.mock.calls[0][0]).toContain('p.deleted_at IS NULL');
    });

    test('refuses a reviewer unless dispatch is automatic', async () => {
      pool.query.mockResolvedValueOnce(dispatchRow('manual'));

      await expect(FixDispatchService.assertCanCreate(42, 'reviewer'))
        .rejects.toThrow('Automatic fix dispatch requires FIX_LOOP_MODE=auto');
    });

    test('allows a human in manual mode and a reviewer in auto mode', async () => {
      pool.query.mockResolvedValue({ rows: [{ fix_loop_mode: 'manual' }] });
      await expect(FixDispatchService.assertCanCreate(42, 'human')).resolves.toBe('manual');

      pool.query.mockResolvedValue({ rows: [{ fix_loop_mode: 'auto' }] });
      await expect(FixDispatchService.assertCanCreate(42, 'reviewer')).resolves.toBe('auto');
    });

    test('rejects an unknown source and a missing ticket', async () => {
      await expect(FixDispatchService.assertCanCreate(42, 'system'))
        .rejects.toThrow('source must be human or reviewer');

      pool.query.mockResolvedValueOnce({ rows: [] });
      await expect(FixDispatchService.assertCanCreate(42, 'human'))
        .rejects.toThrow('Ticket not found');
    });
  });

  describe('prepareManual', () => {
    test('ignores transitions that cannot dispatch a fix', async () => {
      await expect(FixDispatchService.prepareManual(42, {
        toPhase: 'review', actorType: 'human', metadata: { reason: 'x' },
      })).resolves.toBeNull();
      await expect(FixDispatchService.prepareManual(42, {
        toPhase: 'in_progress', actorType: 'agent', metadata: { reason: 'x' },
      })).resolves.toBeNull();
      await expect(FixDispatchService.prepareManual(42, {
        toPhase: 'in_progress', actorType: 'human', metadata: {},
      })).resolves.toBeNull();
      expect(pool.query).not.toHaveBeenCalled();
    });

    test('ignores a ticket that is not in review or a disabled loop', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ phase: 'in_progress', fix_loop_mode: 'manual' }] });
      await expect(FixDispatchService.prepareManual(42, {
        toPhase: 'in_progress', actorType: 'human', metadata: { reason: 'x' },
      })).resolves.toBeNull();

      pool.query.mockResolvedValueOnce({ rows: [{ phase: 'review', fix_loop_mode: 'off' }] });
      await expect(FixDispatchService.prepareManual(42, {
        toPhase: 'in_progress', actorType: 'human', metadata: { reason: 'x' },
      })).resolves.toBeNull();
      expect(FixRequestService.preResolve).not.toHaveBeenCalled();
    });

    test('preflights the branch for a manual request', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ phase: 'review', fix_loop_mode: 'manual' }] });
      FixRequestService.preResolve.mockResolvedValueOnce({
        branchResolution: { branch: 'feat/fix', reviewedSha: 'a'.repeat(40), round: 1 },
      });

      await expect(FixDispatchService.prepareManual(42, {
        toPhase: 'in_progress',
        actorType: 'human',
        metadata: { action: 'changes_requested', reason: ' please fix ' },
      })).resolves.toEqual({
        feedback: 'please fix',
        branchResolution: { branch: 'feat/fix', reviewedSha: 'a'.repeat(40), round: 1 },
      });
      expect(FixRequestService.preResolve).toHaveBeenCalledWith(42, {
        feedback: 'please fix',
      });
    });

    test('returns the existing request instead of a second one', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ phase: 'review', fix_loop_mode: 'manual' }] });
      FixRequestService.preResolve.mockResolvedValueOnce({ existing: { id: 'req-1' } });

      await expect(FixDispatchService.prepareManual(42, {
        toPhase: 'in_progress', actorType: 'human', metadata: { feedback: 'fix it' },
      })).resolves.toEqual({ feedback: 'fix it', existing: { id: 'req-1' } });
    });
  });

  test('exports the class for instrumentation', () => {
    expect(FixDispatchService).toBeInstanceOf(FixDispatchServiceClass);
  });
});
