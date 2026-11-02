jest.mock('../services/HarnessRunService', () => ({
  reapExpiredLeases: jest.fn(),
  releaseTicketForRun: jest.fn(),
}));

const HarnessReaper = require('../services/HarnessReaper');
const HarnessRunService = require('../services/HarnessRunService');

const RUN_A = '11111111-1111-4111-8111-111111111111';
const RUN_B = '22222222-2222-4222-8222-222222222222';

describe('HarnessReaper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    HarnessRunService.reapExpiredLeases.mockResolvedValue([]);
    HarnessRunService.releaseTicketForRun.mockResolvedValue(null);
  });

  it('releases only tickets whose run this sweep failed', async () => {
    HarnessRunService.reapExpiredLeases.mockResolvedValue([
      { ticket_id: 1, run_id: RUN_A, agent_id: 7, run_failed: true },
      { ticket_id: 2, run_id: RUN_B, agent_id: 7, run_failed: false },
    ]);
    HarnessRunService.releaseTicketForRun.mockResolvedValue({ id: 1 });

    const summary = await HarnessReaper.runOnce();

    expect(HarnessRunService.releaseTicketForRun).toHaveBeenCalledTimes(1);
    expect(HarnessRunService.releaseTicketForRun).toHaveBeenCalledWith(RUN_A);
    expect(summary).toEqual({
      reaped: 2,
      released: 1,
      skipped: [{ ticketId: 2, runId: RUN_B, reason: 'run_not_failed' }],
    });
  });

  it('records a skipped ticket when the guarded release refuses', async () => {
    HarnessRunService.reapExpiredLeases.mockResolvedValue([
      { ticket_id: 1, run_id: RUN_A, agent_id: 7, run_failed: true },
    ]);

    const summary = await HarnessReaper.runOnce({ limit: 10, orphanAfterSeconds: 60 });

    expect(HarnessRunService.reapExpiredLeases).toHaveBeenCalledWith(10, 60);
    expect(summary.released).toBe(0);
    expect(summary.skipped).toEqual([
      { ticketId: 1, runId: RUN_A, reason: 'ticket_not_releasable' },
    ]);
  });

  it('keeps sweeping when one release throws', async () => {
    HarnessRunService.reapExpiredLeases.mockResolvedValue([
      { ticket_id: 1, run_id: RUN_A, agent_id: 7, run_failed: true },
      { ticket_id: 2, run_id: RUN_B, agent_id: 7, run_failed: true },
    ]);
    HarnessRunService.releaseTicketForRun
      .mockRejectedValueOnce(new Error('db blip'))
      .mockResolvedValueOnce({ id: 2 });

    const summary = await HarnessReaper.runOnce();

    expect(summary.released).toBe(1);
    expect(summary.skipped).toEqual([
      { ticketId: 1, runId: RUN_A, reason: 'release_failed' },
    ]);
  });

  it('returns an empty summary when nothing is stale', async () => {
    await expect(HarnessReaper.runOnce()).resolves.toEqual({
      reaped: 0,
      released: 0,
      skipped: [],
    });
  });
});
