jest.mock('dockerode', () => {
  const mockContainer = {
    inspect: jest.fn().mockResolvedValue({ State: { Running: true } }),
    exec: jest.fn().mockResolvedValue({
      start: jest.fn().mockResolvedValue({
        on: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      }),
      resize: jest.fn(),
    }),
  };
  const mockDocker = {
    getContainer: jest.fn(() => mockContainer),
  };
  const MockDocker = jest.fn(() => mockDocker);
  MockDocker.prototype = mockDocker;
  return MockDocker;
});

const { TerminalProxy, createTerminalWSS } = require('../services/TerminalProxy');

describe('TerminalProxy', () => {
  let mockDocker;
  let mockContainer;
  let mockExec;
  let mockStream;
  let mockWs;

  beforeEach(() => {
    jest.clearAllMocks();
    // Get the mocked docker instance
    const Docker = require('dockerode');
    mockDocker = Docker();
    mockContainer = mockDocker.getContainer('agent-1');

    mockStream = {
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    };

    mockExec = {
      start: jest.fn().mockResolvedValue(mockStream),
      resize: jest.fn(),
    };
    mockContainer.exec.mockResolvedValue(mockExec);
    mockContainer.inspect.mockResolvedValue({ State: { Running: true } });

    mockWs = {
      send: jest.fn(),
      close: jest.fn(),
      on: jest.fn(),
    };
  });

  describe('start', () => {
    it('throws when container not running', async () => {
      mockContainer.inspect.mockResolvedValueOnce({ State: { Running: false } });

      const proxy = new TerminalProxy(mockWs, 'agent-1');
      await expect(proxy.start()).rejects.toThrow('Container not running');
    });

    it('falls back to sh when bash is unavailable', async () => {
      mockContainer.exec
        .mockRejectedValueOnce(new Error('bash not found'))
        .mockResolvedValueOnce(mockExec);

      const proxy = new TerminalProxy(mockWs, 'agent-1');
      await proxy.start();

      expect(mockContainer.exec).toHaveBeenCalledTimes(2);
    });

    it('sets up stream data handler', async () => {
      const proxy = new TerminalProxy(mockWs, 'agent-1');
      await proxy.start();

      const dataHandler = mockStream.on.mock.calls.find(c => c[0] === 'data');
      expect(dataHandler).toBeDefined();
      dataHandler[1](Buffer.from('output'));

      expect(mockWs.send).toHaveBeenCalled();
    });

    it('closes WS on stream end', async () => {
      const proxy = new TerminalProxy(mockWs, 'agent-1');
      await proxy.start();

      const endHandler = mockStream.on.mock.calls.find(c => c[0] === 'end');
      endHandler[1]();

      expect(mockWs.close).toHaveBeenCalled();
    });

    it('closes WS on stream error', async () => {
      const proxy = new TerminalProxy(mockWs, 'agent-1');
      await proxy.start();

      const errorHandler = mockStream.on.mock.calls.find(c => c[0] === 'error');
      errorHandler[1](new Error('stream error'));

      expect(mockWs.close).toHaveBeenCalled();
    });

    it('routes WS input messages to stream', async () => {
      const proxy = new TerminalProxy(mockWs, 'agent-1');
      await proxy.start();

      const messageHandler = mockWs.on.mock.calls.find(c => c[0] === 'message');
      messageHandler[1](JSON.stringify({ type: 'input', data: 'dGVzdA==' }));

      expect(mockStream.write).toHaveBeenCalled();
    });

    it('routes WS resize messages to exec', async () => {
      const proxy = new TerminalProxy(mockWs, 'agent-1');
      await proxy.start();

      const messageHandler = mockWs.on.mock.calls.find(c => c[0] === 'message');
      messageHandler[1](JSON.stringify({ type: 'resize', cols: 80, rows: 24 }));

      expect(mockExec.resize).toHaveBeenCalledWith({ w: 80, h: 24 });
    });

    it('calls cleanup on WS close', async () => {
      const proxy = new TerminalProxy(mockWs, 'agent-1');
      await proxy.start();

      const closeHandler = mockWs.on.mock.calls.find(c => c[0] === 'close');
      closeHandler[1]();

      expect(mockStream.end).toHaveBeenCalled();
    });

    it('calls cleanup on WS error', async () => {
      const proxy = new TerminalProxy(mockWs, 'agent-1');
      await proxy.start();

      const errorHandler = mockWs.on.mock.calls.find(c => c[0] === 'error');
      errorHandler[1]();

      expect(mockStream.end).toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('ends stream and nulls references', () => {
      const proxy = new TerminalProxy(mockWs, 'agent-1');
      proxy.stream = mockStream;
      proxy.exec = mockExec;

      proxy.cleanup();

      expect(mockStream.end).toHaveBeenCalled();
      expect(proxy.stream).toBeNull();
      expect(proxy.exec).toBeNull();
    });

    it('is idempotent', () => {
      const proxy = new TerminalProxy(mockWs, 'agent-1');
      proxy.cleanup();
      proxy.cleanup();
    });
  });
});

describe('createTerminalWSS', () => {
  it('creates a WebSocketServer', () => {
    const wss = createTerminalWSS();

    expect(wss).toBeDefined();
  });
});
