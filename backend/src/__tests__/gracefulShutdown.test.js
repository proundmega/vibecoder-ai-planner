const { gracefulShutdown, isShuttingDown, resetShutdownState } = require('../utils/shutdown');

describe('BP-12: Graceful Shutdown', () => {
  let mockServer;
  let mockPool;
  let exitCode;
  let originalExit;
  let originalSetTimeout;

  beforeEach(() => {
    exitCode = null;
    originalExit = process.exit;
    originalSetTimeout = global.setTimeout;

    process.exit = jest.fn((code) => {
      exitCode = code;
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

  it('should register SIGTERM handler', () => {
    const handlers = {};
    process.on = jest.fn((signal, handler) => {
      handlers[signal] = handler;
    });

    gracefulShutdown(mockServer, mockPool);

    expect(process.on).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(process.on).toHaveBeenCalledWith('SIGINT', expect.any(Function));
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

  it('should force exit after timeout', () => {
    const handlers = {};
    process.on = jest.fn((signal, handler) => {
      handlers[signal] = handler;
    });

    global.setTimeout = jest.fn((fn, ms) => {
      if (ms >= 30000) {
        fn();
      }
    });

    gracefulShutdown(mockServer, mockPool);

    expect(global.setTimeout).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
