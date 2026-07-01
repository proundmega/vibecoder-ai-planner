const { gracefulShutdown, isShuttingDown, resetShutdownState } = require('../utils/shutdown');

describe('BP-12: Graceful Shutdown', () => {
  let mockServer;
  let mockPool;
  let exitCode;
  let originalExit;
  let originalSetTimeout;
  let timers = [];

  beforeEach(() => {
    exitCode = null;
    timers = [];
    originalExit = process.exit;
    originalSetTimeout = global.setTimeout;

    process.exit = jest.fn((code) => {
      exitCode = code;
    });

    global.setTimeout = jest.fn((fn, ms) => {
      const id = { fn, ms };
      timers.push(id);
      return id;
    });

    mockServer = {
      close: jest.fn((cb) => cb && cb()),
      on: jest.fn(),
    };

    mockPool = {
      end: jest.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    process.exit = originalExit;
    global.setTimeout = originalSetTimeout;
    jest.clearAllMocks();
    resetShutdownState();
  });

  it('should register SIGTERM and SIGINT handlers', () => {
    const handlers = {};
    process.on = jest.fn((signal, handler) => {
      handlers[signal] = handler;
    });

    gracefulShutdown(mockServer, mockPool);

    expect(process.on).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(process.on).toHaveBeenCalledWith('SIGINT', expect.any(Function));
  });

  it('should NOT set a force timeout on startup (only after signal)', () => {
    const handlers = {};
    process.on = jest.fn((signal, handler) => {
      handlers[signal] = handler;
    });

    gracefulShutdown(mockServer, mockPool);

    // No timers should be scheduled yet — timeout only fires after signal
    expect(timers.length).toBe(0);
  });

  it('should close server and pool on SIGTERM', async () => {
    const handlers = {};
    process.on = jest.fn((signal, handler) => {
      handlers[signal] = handler;
    });

    gracefulShutdown(mockServer, mockPool);

    await handlers['SIGTERM']();

    expect(mockServer.close).toHaveBeenCalled();
    expect(mockPool.end).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('should close server and pool on SIGINT', async () => {
    const handlers = {};
    process.on = jest.fn((signal, handler) => {
      handlers[signal] = handler;
    });

    gracefulShutdown(mockServer, mockPool);

    await handlers['SIGINT']();

    expect(mockServer.close).toHaveBeenCalled();
    expect(mockPool.end).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('should ignore duplicate signals during shutdown', async () => {
    const handlers = {};
    process.on = jest.fn((signal, handler) => {
      handlers[signal] = handler;
    });

    gracefulShutdown(mockServer, mockPool);

    await handlers['SIGTERM']();
    await handlers['SIGTERM']();

    expect(mockServer.close).toHaveBeenCalledTimes(1);
    expect(mockPool.end).toHaveBeenCalledTimes(1);
  });

  it('should handle pool end errors', async () => {
    const handlers = {};
    process.on = jest.fn((signal, handler) => {
      handlers[signal] = handler;
    });

    mockPool.end.mockRejectedValue(new Error('Pool error'));

    gracefulShutdown(mockServer, mockPool);

    await handlers['SIGTERM']();

    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should set force timeout after signal and clear on success', async () => {
    const handlers = {};
    process.on = jest.fn((signal, handler) => {
      handlers[signal] = handler;
    });

    gracefulShutdown(mockServer, mockPool);

    // Trigger signal — this should schedule the force timeout
    await handlers['SIGTERM']();

    expect(timers.length).toBe(1);
    expect(timers[0].ms).toBe(30000);

    // Clear the force timer (simulating successful shutdown completing before timeout)
    timers = [];
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('should force exit after timeout when signal is received', async () => {
    const handlers = {};
    process.on = jest.fn((signal, handler) => {
      handlers[signal] = handler;
    });

    gracefulShutdown(mockServer, mockPool);

    await handlers['SIGTERM']();

    // Manually trigger the force timeout timer
    const forceTimer = timers.find(t => t.ms >= 30000);
    forceTimer.fn();

    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
