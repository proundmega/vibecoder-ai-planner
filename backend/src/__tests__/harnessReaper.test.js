jest.mock('../services/HarnessRunService', () => ({
  reapExpiredLeases: jest.fn(),
  listTerminalRunsForReconcile: jest.fn(),
  reconcileRun: jest.fn(),
}));

const HarnessReaper = require('../services/HarnessReaper');
const HarnessRunService = require('../services/HarnessRunService');

const RUN_A = '11111111-1111-4111-8111-111111111111';
const RUN_B = '22222222-2222-4222-8222-222222222222';

describe('HarnessReaper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    HarnessRunService.reapExpiredLeases.mockResolvedValue([]);
    HarnessRunService.listTerminalRunsForReconcile.mockResolvedValue([]);
    HarnessRunService.reconcileRun.mockResolvedValue({
      run_id: RUN_A, ticket_id: 1, adopted: false, released: false, marked: true,
    });
  });

  it('reconciles reaped runs and pending terminal runs', async () => {
    HarnessRunService.reapExpiredLeases.mockResolvedValue([
      { ticket_id: 1, run_id: RUN_A, agent_id: 7, run_failed: true },
    ]);
    HarnessRunService.listTerminalRunsForReconcile.mockResolvedValue([RUN_B]);
    HarnessRunService.reconcileRun
      .mockResolvedValueOnce({
        run_id: RUN_A, ticket_id: 1, adopted: false, released: true, marked: true,
      })
      .mockResolvedValueOnce({
        run_id: RUN_B, ticket_id: 2, adopted: true, released: false, marked: true,
      });

    const summary = await HarnessReaper.runOnce({ limit: 10, orphanAfterSeconds: 60 });

    expect(HarnessRunService.reapExpiredLeases).toHaveBeenCalledWith(10, 60);
    expect(HarnessRunService.listTerminalRunsForReconcile).toHaveBeenCalledWith(10);
    expect(HarnessRunService.reconcileRun).toHaveBeenCalledTimes(2);
    expect(summary).toEqual({
      reaped: 1,
      released: 1,
      adopted: 1,
      reconciled: 2,
      skipped: [],
    });
  });

  it('adopts a published run instead of releasing its ticket', async () => {
    HarnessRunService.reapExpiredLeases.mockResolvedValue([
      { ticket_id: 1, run_id: RUN_A, agent_id: 7, run_failed: false },
    ]);
    HarnessRunService.reconcileRun.mockResolvedValue({
      run_id: RUN_A, ticket_id: 1, adopted: true, released: false, marked: true,
    });

    const summary = await HarnessReaper.runOnce();

    expect(summary.released).toBe(0);
    expect(summary.adopted).toBe(1);
    expect(HarnessRunService.reconcileRun).toHaveBeenCalledWith(RUN_A);
  });

  it('does not process the same run twice in one sweep', async () => {
    HarnessRunService.reapExpiredLeases.mockResolvedValue([
      { ticket_id: 1, run_id: RUN_A, agent_id: 7, run_failed: true },
    ]);
    HarnessRunService.listTerminalRunsForReconcile.mockResolvedValue([RUN_A]);

    await HarnessReaper.runOnce();

    expect(HarnessRunService.reconcileRun).toHaveBeenCalledTimes(1);
  });

  it('leaves a failed reconcile for the next sweep', async () => {
    HarnessRunService.reapExpiredLeases.mockResolvedValue([
      { ticket_id: 1, run_id: RUN_A, agent_id: 7, run_failed: true },
    ]);
    HarnessRunService.reconcileRun
      .mockRejectedValueOnce(new Error('db blip'))
      .mockResolvedValueOnce({
        run_id: RUN_A, ticket_id: 1, adopted: false, released: true, marked: true,
      });

    const first = await HarnessReaper.runOnce();
    expect(first.released).toBe(0);
    expect(first.skipped).toEqual([
      { ticketId: 1, runId: RUN_A, reason: 'reconcile_failed' },
    ]);

    HarnessRunService.reapExpiredLeases.mockResolvedValue([]);
    HarnessRunService.listTerminalRunsForReconcile.mockResolvedValue([RUN_A]);

    const second = await HarnessReaper.runOnce();
    expect(second.released).toBe(1);
    expect(second.skipped).toEqual([]);
  });

  it('keeps sweeping when pending terminal runs cannot be listed', async () => {
    HarnessRunService.reapExpiredLeases.mockResolvedValue([
      { ticket_id: 1, run_id: RUN_A, agent_id: 7, run_failed: true },
    ]);
    HarnessRunService.reconcileRun.mockResolvedValue({
      run_id: RUN_A, ticket_id: 1, adopted: false, released: true, marked: true,
    });
    HarnessRunService.listTerminalRunsForReconcile.mockRejectedValue(new Error('db blip'));

    const summary = await HarnessReaper.runOnce();

    expect(summary.released).toBe(1);
    expect(summary.reconciled).toBe(1);
  });

  it('returns an empty summary when nothing is stale', async () => {
    await expect(HarnessReaper.runOnce()).resolves.toEqual({
      reaped: 0,
      released: 0,
      adopted: 0,
      reconciled: 0,
      skipped: [],
    });
  });
});
